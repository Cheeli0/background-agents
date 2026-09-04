from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sandbox_runtime.opencode_server import OpenCodeServer
from sandbox_runtime.runtime_config import OpenCodeConfig


def make_server(tmp_path: Path, provider: str, model: str) -> OpenCodeServer:
    return OpenCodeServer(
        OpenCodeConfig(
            provider=provider,
            model=model,
            mcp_servers=(),
            has_repository=True,
            workspace_path=tmp_path,
        ),
        asyncio.Event(),
        MagicMock(),
        MagicMock(),
    )


@pytest.mark.parametrize(
    ("provider", "model", "secret_name", "expected_key"),
    [
        ("opencode-go", "glm-5.1", "OPENCODE_GO_API_KEY", "go-secret"),
        ("zai-coding-plan", "glm-5.3-flash", "ZHIPU_API_KEY", "zai-secret"),
    ],
)
def test_setup_provider_auth_writes_selected_provider_entries(
    tmp_path, provider, model, secret_name, expected_key
):
    server = make_server(tmp_path, provider, model)

    with (
        patch.dict("os.environ", {secret_name: expected_key}, clear=True),
        patch("sandbox_runtime.opencode_server.write_auth_entries") as write_entries,
    ):
        server._setup_provider_auth()

    write_entries.assert_called_once_with({provider: {"type": "api", "key": expected_key}})


async def test_start_routes_model_and_deploys_selected_provider_plugin(tmp_path):
    server = make_server(tmp_path, "minimax-coding-plan", "MiniMax-M2.7")
    (tmp_path / ".git").mkdir()
    plugin_source = tmp_path / "image" / "minimax-auth-plugin.js"
    plugin_source.parent.mkdir()
    plugin_source.write_text("export const MiniMaxAuthPlugin = async () => ({});")
    fake_process = MagicMock(stdout=None)
    original_path = Path

    with (
        patch.dict("os.environ", {"MINIMAX_API_KEY": "secret"}, clear=True),
        patch("sandbox_runtime.opencode_server.Path") as mock_path,
        patch("sandbox_runtime.opencode_server.shutil.copy") as copy_file,
        patch(
            "sandbox_runtime.opencode_server.asyncio.create_subprocess_exec",
            AsyncMock(return_value=fake_process),
        ) as create_process,
        patch(
            "sandbox_runtime.opencode_server.asyncio.create_task",
            side_effect=lambda coroutine: coroutine.close(),
        ),
    ):
        mock_path.side_effect = lambda path: {
            "/app/sandbox_runtime/plugins/minimax-auth-plugin.js": plugin_source,
        }.get(path, original_path(path))
        server._setup_managed_oauth = MagicMock()
        server._setup_provider_auth = MagicMock()
        server._prepare_opencode_filesystem = MagicMock(return_value=set())
        server._wait_for_health = AsyncMock()

        await server.start((), tmp_path)

    process_environment = create_process.call_args.kwargs["env"]
    config = json.loads(process_environment["OPENCODE_CONFIG_CONTENT"])
    assert config["model"] == "minimax-coding-plan/MiniMax-M2.7"
    copy_file.assert_called_once_with(
        plugin_source,
        tmp_path / ".opencode" / "plugins" / "minimax-auth-plugin.js",
    )
