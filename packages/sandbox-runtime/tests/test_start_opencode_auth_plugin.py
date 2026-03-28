"""Tests for Codex auth plugin deployment during OpenCode startup."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sandbox_runtime.entrypoint import SandboxSupervisor


def _make_supervisor(session_config: dict | None = None) -> SandboxSupervisor:
    """Create a SandboxSupervisor with default test config."""
    config = session_config or {"provider": "openai", "model": "gpt-5.4"}
    with patch.dict(
        "os.environ",
        {
            "SANDBOX_ID": "test-sandbox",
            "CONTROL_PLANE_URL": "https://cp.example.com",
            "SANDBOX_AUTH_TOKEN": "tok",
            "REPO_OWNER": "acme",
            "REPO_NAME": "app",
            "SESSION_CONFIG": json.dumps(config),
        },
    ):
        return SandboxSupervisor()


def _fake_process():
    proc = MagicMock()
    proc.stdout = None
    proc.returncode = None
    return proc


@pytest.mark.asyncio
async def test_deploys_codex_plugin_for_openai_provider(tmp_path):
    supervisor = _make_supervisor({"provider": "openai", "model": "gpt-5.4"})
    supervisor.workspace_path = tmp_path
    supervisor.repo_path = tmp_path / "missing-repo"
    supervisor._setup_opencode_auth = MagicMock()
    supervisor._install_tools = MagicMock()
    supervisor._wait_for_health = AsyncMock()

    original_exists = Path.exists

    def fake_exists(path_obj):
        if str(path_obj) == "/app/sandbox_runtime/plugins/codex-auth-plugin.ts":
            return True
        return original_exists(path_obj)

    with (
        patch.dict("os.environ", {"OPENAI_OAUTH_REFRESH_TOKEN": "rt_abc"}, clear=False),
        patch("pathlib.Path.exists", new=fake_exists),
        patch("sandbox_runtime.entrypoint.shutil.copy") as copy_mock,
        patch(
            "sandbox_runtime.entrypoint.asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=_fake_process()),
        ),
    ):
        await supervisor.start_opencode()

    copy_targets = [str(call.args[1]).replace("\\", "/") for call in copy_mock.call_args_list]
    assert any(target.endswith(".opencode/plugins/codex-auth-plugin.ts") for target in copy_targets)


@pytest.mark.asyncio
async def test_skips_codex_plugin_for_github_copilot_provider(tmp_path):
    supervisor = _make_supervisor({"provider": "github-copilot", "model": "gpt-5"})
    supervisor.workspace_path = tmp_path
    supervisor.repo_path = tmp_path / "missing-repo"
    supervisor._setup_opencode_auth = MagicMock()
    supervisor._install_tools = MagicMock()
    supervisor._wait_for_health = AsyncMock()

    original_exists = Path.exists

    def fake_exists(path_obj):
        if str(path_obj) == "/app/sandbox_runtime/plugins/codex-auth-plugin.ts":
            return True
        return original_exists(path_obj)

    with (
        patch.dict("os.environ", {"OPENAI_OAUTH_REFRESH_TOKEN": "rt_abc"}, clear=False),
        patch("pathlib.Path.exists", new=fake_exists),
        patch("sandbox_runtime.entrypoint.shutil.copy") as copy_mock,
        patch(
            "sandbox_runtime.entrypoint.asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=_fake_process()),
        ),
    ):
        await supervisor.start_opencode()

    copy_targets = [str(call.args[1]).replace("\\", "/") for call in copy_mock.call_args_list]
    assert not any(
        target.endswith(".opencode/plugins/codex-auth-plugin.ts") for target in copy_targets
    )


@pytest.mark.asyncio
async def test_uses_zai_coding_plan_provider_name_in_config(tmp_path):
    supervisor = _make_supervisor({"provider": "zai-coding-plan", "model": "glm-5"})
    supervisor.workspace_path = tmp_path
    supervisor.repo_path = tmp_path / "missing-repo"
    supervisor._setup_opencode_auth = MagicMock()
    supervisor._install_tools = MagicMock()
    supervisor._wait_for_health = AsyncMock()

    with patch(
        "sandbox_runtime.entrypoint.asyncio.create_subprocess_exec",
        new=AsyncMock(return_value=_fake_process()),
    ) as exec_mock:
        await supervisor.start_opencode()

    assert exec_mock.await_args is not None
    env = exec_mock.await_args.kwargs["env"]
    config = json.loads(env["OPENCODE_CONFIG_CONTENT"])
    assert config["model"] == "zai-coding-plan/glm-5"


@pytest.mark.asyncio
async def test_uses_fireworks_provider_name_in_config(tmp_path):
    supervisor = _make_supervisor({"provider": "fireworks-ai", "model": "kimi-k2p5-turbo"})
    supervisor.workspace_path = tmp_path
    supervisor.repo_path = tmp_path / "missing-repo"
    supervisor._setup_opencode_auth = MagicMock()
    supervisor._install_tools = MagicMock()
    supervisor._wait_for_health = AsyncMock()

    with patch(
        "sandbox_runtime.entrypoint.asyncio.create_subprocess_exec",
        new=AsyncMock(return_value=_fake_process()),
    ) as exec_mock:
        await supervisor.start_opencode()

    assert exec_mock.await_args is not None
    env = exec_mock.await_args.kwargs["env"]
    config = json.loads(env["OPENCODE_CONFIG_CONTENT"])
    assert config["model"] == "fireworks-ai/kimi-k2p5-turbo"
