"""Tests for SandboxSupervisor._setup_opencode_auth()."""

import json
import os
from unittest.mock import patch

import pytest

from sandbox_runtime.entrypoint import SandboxSupervisor


@pytest.fixture(autouse=True)
def _clear_managed_auth_env(monkeypatch):
    for key in (
        "OPENAI_OAUTH_REFRESH_TOKEN",
        "OPENAI_OAUTH_ACCOUNT_ID",
        "OPENCODE_AUTH_JSON",
        "ZAI_API_KEY",
        "FIREWORKS_API_KEY",
        "MINIMAX_API_KEY",
        "OPENCODE_GO_API_KEY",
    ):
        monkeypatch.delenv(key, raising=False)


def _make_supervisor() -> SandboxSupervisor:
    """Create a SandboxSupervisor with default test config."""
    with patch.dict(
        "os.environ",
        {
            "SANDBOX_ID": "test-sandbox",
            "CONTROL_PLANE_URL": "https://cp.example.com",
            "SANDBOX_AUTH_TOKEN": "tok",
            "REPO_OWNER": "acme",
            "REPO_NAME": "app",
        },
        clear=True,
    ):
        return SandboxSupervisor()


def _auth_file(tmp_path):
    """Return the expected auth.json path under tmp_path."""
    return tmp_path / ".local" / "share" / "opencode" / "auth.json"


class TestOpenCodeAuthSetup:
    """Cases for _setup_opencode_auth()."""

    def test_writes_openai_auth_json_when_refresh_token_present(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"OPENAI_OAUTH_REFRESH_TOKEN": "rt_abc123"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("openai")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data == {
            "openai": {
                "type": "oauth",
                "refresh": "managed-by-control-plane",
                "access": "",
                "expires": 0,
            }
        }

    def test_includes_account_id_when_present(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENAI_OAUTH_REFRESH_TOKEN": "rt_abc123",
                    "OPENAI_OAUTH_ACCOUNT_ID": "acct_xyz",
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("openai")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["openai"]["accountId"] == "acct_xyz"

    def test_merges_base_auth_json_with_managed_openai_entry(self, tmp_path):
        sup = _make_supervisor()
        base_auth = {
            "github-copilot": {
                "type": "oauth",
                "access": "copilot-access",
                "refresh": "copilot-refresh",
                "expires": 123,
            },
            "openai": {
                "type": "oauth",
                "access": "stale-token",
                "refresh": "stale-refresh",
                "expires": 456,
            },
        }

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(base_auth),
                    "OPENAI_OAUTH_REFRESH_TOKEN": "rt_abc123",
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("openai")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["github-copilot"]["access"] == "copilot-access"
        assert data["openai"] == {
            "type": "oauth",
            "refresh": "managed-by-control-plane",
            "access": "",
            "expires": 0,
        }

    def test_skips_when_no_auth_is_configured(self, tmp_path, monkeypatch):
        sup = _make_supervisor()

        monkeypatch.delenv("OPENAI_OAUTH_REFRESH_TOKEN", raising=False)
        monkeypatch.delenv("OPENCODE_AUTH_JSON", raising=False)

        with patch("pathlib.Path.home", return_value=tmp_path):
            sup._setup_opencode_auth("anthropic")

        assert not _auth_file(tmp_path).exists()

    def test_sets_secure_permissions(self, tmp_path):
        if os.name == "nt":
            pytest.skip("POSIX file mode bits are not reliable on Windows")

        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"OPENAI_OAUTH_REFRESH_TOKEN": "rt_abc123"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("openai")

        mode = _auth_file(tmp_path).stat().st_mode & 0o777
        assert mode == 0o600

    def test_no_temp_file_left_on_write_failure(self, tmp_path):
        sup = _make_supervisor()
        original_open = os.open

        def fail_on_tmp(path, *args, **kwargs):
            if ".auth.json.tmp" in path:
                raise OSError("disk full")
            return original_open(path, *args, **kwargs)

        with (
            patch.dict("os.environ", {"OPENAI_OAUTH_REFRESH_TOKEN": "rt_abc123"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
            patch("os.open", side_effect=fail_on_tmp),
            pytest.raises(RuntimeError, match="Failed to configure OpenCode credentials"),
        ):
            sup._setup_opencode_auth("openai")

        auth_dir = tmp_path / ".local" / "share" / "opencode"
        tmp_file = auth_dir / ".auth.json.tmp"
        assert not tmp_file.exists()

    def test_rejects_invalid_auth_json(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"OPENCODE_AUTH_JSON": "{invalid"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="OPENCODE_AUTH_JSON must be valid JSON"),
        ):
            sup._setup_opencode_auth("github-copilot")

    def test_rejects_non_object_auth_json(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"OPENCODE_AUTH_JSON": '["bad"]'}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="OPENCODE_AUTH_JSON must be a JSON object"),
        ):
            sup._setup_opencode_auth("github-copilot")

    def test_fails_fast_for_copilot_without_credentials(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="GitHub Copilot credentials are not configured"),
        ):
            sup._setup_opencode_auth("github-copilot")

    def test_accepts_copilot_auth_blob(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(
                        {
                            "github-copilot": {
                                "type": "oauth",
                                "access": "copilot-access",
                                "refresh": "copilot-refresh",
                                "expires": 123,
                            }
                        }
                    )
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("github-copilot")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["github-copilot"]["access"] == "copilot-access"

    def test_accepts_direct_copilot_provider_entry(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(
                        {
                            "type": "oauth",
                            "access": "copilot-access",
                            "refresh": "copilot-refresh",
                            "expires": 123,
                        }
                    )
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("github-copilot")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["github-copilot"]["access"] == "copilot-access"
        assert data["copilot"]["access"] == "copilot-access"

    def test_accepts_full_auth_blob_with_copilot_key(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(
                        {
                            "copilot": {
                                "type": "oauth",
                                "access": "copilot-access",
                                "refresh": "copilot-refresh",
                                "expires": 123,
                            }
                        }
                    )
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("github-copilot")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["github-copilot"]["access"] == "copilot-access"
        assert data["copilot"]["access"] == "copilot-access"

    def test_fails_fast_for_zai_without_credentials(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match=r"Z\.AI credentials are not configured"),
        ):
            sup._setup_opencode_auth("zai-coding-plan")

    def test_rejects_opencode_auth_json_for_zai(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(
                        {
                            "zai": {
                                "type": "api",
                                "key": "zai-api-key",
                            }
                        }
                    )
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="Add ZAI_API_KEY"),
        ):
            sup._setup_opencode_auth("zai-coding-plan")

    def test_writes_zai_auth_json_when_api_key_present(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"ZAI_API_KEY": "zai-api-key"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("zai-coding-plan")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["zai"] == {"type": "api", "key": "zai-api-key"}
        assert data["zai-coding-plan"] == {"type": "api", "key": "zai-api-key"}

    def test_fails_fast_for_minimax_without_credentials(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="MiniMax credentials are not configured"),
        ):
            sup._setup_opencode_auth("minimax-coding-plan")

    def test_rejects_opencode_auth_json_for_minimax(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(
                        {
                            "minimax": {
                                "type": "api",
                                "key": "minimax-api-key",
                            }
                        }
                    )
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="Add MINIMAX_API_KEY"),
        ):
            sup._setup_opencode_auth("minimax-coding-plan")

    def test_writes_minimax_auth_json_when_api_key_present(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"MINIMAX_API_KEY": "minimax-api-key"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("minimax-coding-plan")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["minimax"] == {"type": "api", "key": "minimax-api-key"}
        assert data["minimax-coding-plan"] == {"type": "api", "key": "minimax-api-key"}

    def test_fails_fast_for_fireworks_without_credentials(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="Fireworks AI credentials are not configured"),
        ):
            sup._setup_opencode_auth("fireworks-ai")

    def test_rejects_opencode_auth_json_for_fireworks(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(
                        {
                            "fireworks-ai": {
                                "type": "api",
                                "key": "fireworks-api-key",
                            }
                        }
                    )
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="Add FIREWORKS_API_KEY"),
        ):
            sup._setup_opencode_auth("fireworks-ai")

    def test_writes_fireworks_auth_json_when_api_key_present(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"FIREWORKS_API_KEY": "fireworks-api-key"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("fireworks-ai")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["fireworks"] == {"type": "api", "key": "fireworks-api-key"}
        assert data["fireworks-ai"] == {"type": "api", "key": "fireworks-api-key"}

    def test_fails_fast_for_opencode_go_without_credentials(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="OpenCode Go credentials are not configured"),
        ):
            sup._setup_opencode_auth("opencode-go")

    def test_rejects_opencode_auth_json_for_opencode_go(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict(
                "os.environ",
                {
                    "OPENCODE_AUTH_JSON": json.dumps(
                        {
                            "opencode-go": {
                                "type": "api",
                                "key": "opencode-go-api-key",
                            }
                        }
                    )
                },
                clear=False,
            ),
            patch("pathlib.Path.home", return_value=tmp_path),
            pytest.raises(RuntimeError, match="Add OPENCODE_GO_API_KEY"),
        ):
            sup._setup_opencode_auth("opencode-go")

    def test_writes_opencode_go_auth_json_when_api_key_present(self, tmp_path):
        sup = _make_supervisor()

        with (
            patch.dict("os.environ", {"OPENCODE_GO_API_KEY": "opencode-go-api-key"}, clear=False),
            patch("pathlib.Path.home", return_value=tmp_path),
        ):
            sup._setup_opencode_auth("opencode-go")

        data = json.loads(_auth_file(tmp_path).read_text())
        assert data["opencode-go"] == {"type": "api", "key": "opencode-go-api-key"}
