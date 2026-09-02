from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from sandbox_runtime.process_output import terminate_owned_subprocess


async def test_terminate_owned_subprocess_falls_back_to_process_kill_without_killpg(monkeypatch):
    process = MagicMock()
    process.pid = 123
    process.returncode = None
    process.wait = AsyncMock(return_value=0)
    monkeypatch.delattr("sandbox_runtime.process_output.os.killpg", raising=False)

    await terminate_owned_subprocess(process)

    process.kill.assert_called_once_with()
    process.wait.assert_awaited_once_with()
