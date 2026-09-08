"""Resilient decoding for child-process output streams."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

TRUNCATED_LINE_NOTICE = "[log line too large to forward; truncated]"
TERMINATE_SIGNAL = getattr(signal, "SIGTERM", 15)
KILL_SIGNAL = getattr(signal, "SIGKILL", 9)


async def terminate_owned_subprocess(
    process: asyncio.subprocess.Process,
    *,
    kill_process_group: Callable[[int, int], None] | None = None,
    terminate_grace_seconds: float = 0,
) -> None:
    """Kill a child-owned process group and reap its leader."""
    process_id = getattr(process, "pid", None)
    group_killer = (
        kill_process_group if kill_process_group is not None else getattr(os, "killpg", None)
    )

    def send_signal(sig: int) -> None:
        with contextlib.suppress(ProcessLookupError):
            if isinstance(process_id, int) and group_killer is not None:
                group_killer(process_id, sig)
            elif process.returncode is None:
                if sig == TERMINATE_SIGNAL:
                    process.terminate()
                else:
                    process.kill()

    try:
        if terminate_grace_seconds > 0:
            send_signal(TERMINATE_SIGNAL)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(process.wait(), timeout=terminate_grace_seconds)
    finally:
        # The leader may have exited while descendants still hold its output pipes.
        send_signal(KILL_SIGNAL)
        await asyncio.shield(process.wait())


async def communicate_owned_subprocess(
    process: asyncio.subprocess.Process,
    *,
    kill_process_group: Callable[[int, int], None] | None = None,
    terminate_grace_seconds: float = 0,
) -> tuple[bytes, bytes]:
    """Communicate with a child, cleaning up its process group on failure."""
    try:
        stdout, stderr = await process.communicate()
        return stdout or b"", stderr or b""
    except (asyncio.CancelledError, Exception):
        await terminate_owned_subprocess(
            process,
            kill_process_group=kill_process_group,
            terminate_grace_seconds=terminate_grace_seconds,
        )
        raise


async def iter_process_lines(
    stream: asyncio.StreamReader,
    *,
    on_error: Callable[[Exception], None],
) -> AsyncIterator[str]:
    """Yield decoded lines while surviving oversized and malformed output."""
    while True:
        try:
            raw = await stream.readline()
        except ValueError:
            yield TRUNCATED_LINE_NOTICE
            continue
        except Exception as error:
            on_error(error)
            return
        if not raw:
            return
        yield raw.decode("utf-8", errors="replace").rstrip()
