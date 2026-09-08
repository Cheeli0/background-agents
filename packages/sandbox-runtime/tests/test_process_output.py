"""Owned subprocess cleanup without network or Git operations."""

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

from sandbox_runtime.process_output import (
    KILL_SIGNAL,
    TERMINATE_SIGNAL,
    communicate_owned_subprocess,
    terminate_owned_subprocess,
)


@pytest.mark.parametrize("returncode", [None, 0])
@pytest.mark.parametrize("missing_group", [False, True])
async def test_communication_error_kills_group_and_reaps(returncode, missing_group):
    error = OSError("read failed")
    process = MagicMock(pid=123, returncode=returncode)
    process.communicate = AsyncMock(side_effect=error)
    process.wait = AsyncMock()
    group_signal = MagicMock(side_effect=ProcessLookupError if missing_group else None)

    with pytest.raises(OSError, match="read failed") as caught:
        await communicate_owned_subprocess(process, kill_process_group=group_signal)

    assert caught.value is error
    group_signal.assert_called_once_with(123, KILL_SIGNAL)
    process.wait.assert_awaited_once()


@pytest.mark.parametrize("grace_seconds", [0, 0.1])
async def test_local_process_cancellation_reaps_before_propagating(grace_seconds):
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import time; print('ready', flush=True); time.sleep(60)",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    task = asyncio.create_task(
        communicate_owned_subprocess(process, terminate_grace_seconds=grace_seconds)
    )
    try:
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=2)
        assert process.returncode is not None
        assert await process.wait() == process.returncode
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


async def test_cancellation_during_grace_still_kills_and_reaps():
    waiting = asyncio.Event()
    process = MagicMock(pid=123, returncode=None)
    group_signal = MagicMock()

    async def wait():
        if process.wait.await_count == 1:
            waiting.set()
            await asyncio.Future()

    process.wait = AsyncMock(side_effect=wait)
    task = asyncio.create_task(
        terminate_owned_subprocess(
            process, kill_process_group=group_signal, terminate_grace_seconds=5
        )
    )
    await waiting.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [call.args for call in group_signal.call_args_list] == [
        (123, TERMINATE_SIGNAL),
        (123, KILL_SIGNAL),
    ]
    assert process.wait.await_count == 2


async def test_terminate_owned_subprocess_falls_back_without_killpg(monkeypatch):
    process = MagicMock(pid=123, returncode=None)
    process.wait = AsyncMock(return_value=0)
    monkeypatch.delattr("sandbox_runtime.process_output.os.killpg", raising=False)

    await terminate_owned_subprocess(process)

    process.kill.assert_called_once_with()
    process.wait.assert_awaited_once_with()
