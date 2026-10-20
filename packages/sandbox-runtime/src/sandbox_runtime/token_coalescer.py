"""Fork-only: coalesce streamed token events before they leave the sandbox.

Every token event the control plane receives is an upsert in the session
Durable Object, and Durable Object SQLite bills every row written. Harnesses
stream far faster than anyone reads: Claude sends one event per text delta and
OpenCode is unthrottled. Token content is cumulative per message (and per part
for OpenCode), so only the latest frame for a key carries anything a reader
needs; the frames in between can be dropped without losing text.

The coalescer forwards at most one flush per `TOKEN_COALESCE_INTERVAL_SECONDS`.
A token arriving after a quiet interval goes out at once; later ones wait for
the trailing flush. Any other event flushes the pending tokens first, so the
timeline order of tokens against tool calls, steps and `execution_complete` is
unchanged, and the turn's final text is always delivered before its completion.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Final

from .event_size import MAX_EVENT_BYTES, event_size_bytes

if TYPE_CHECKING:
    from .log_config import StructuredLogger

TOKEN_COALESCE_INTERVAL_SECONDS: Final = 0.2

# Room for the sandboxId and timestamp the forwarder stamps on every event. A
# token this close to the size limit is sent at once rather than held, so the
# forwarder's refusal still reaches the caller that has to report it.
_ENVELOPE_HEADROOM_BYTES: Final = 1024

EventSender = Callable[[dict[str, Any]], Awaitable[bool]]


class TokenCoalescer:
    """Holds the latest token frame per (messageId, partId) between flushes."""

    def __init__(
        self,
        send: EventSender,
        *,
        log: StructuredLogger,
        interval_seconds: float = TOKEN_COALESCE_INTERVAL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._send = send
        self._log = log
        self._interval_seconds = interval_seconds
        self._clock = clock
        self._pending: dict[tuple[Any, Any], dict[str, Any]] = {}
        # Serializes flushes against other sends, so a trailing flush can never
        # interleave with the non-token event that should follow it.
        self._lock = asyncio.Lock()
        self._last_flush_at: float | None = None
        self._timer: asyncio.Task[None] | None = None

    async def send(self, event: dict[str, Any]) -> bool:
        """Forward `event`, holding a token for the next flush when one is due later.

        Returns what the underlying sender returned. A held token reports
        True: it is accepted and will be flushed, and it can't be refused for
        its size, because tokens near the limit are never held.
        """
        if event.get("type") != "token" or self._near_size_limit(event):
            async with self._lock:
                await self._flush_locked()
                return await self._send(event)

        self._pending[(event.get("messageId"), event.get("partId"))] = event
        delay = self._delay_seconds()
        if delay <= 0:
            async with self._lock:
                await self._flush_locked()
        elif self._timer is None:
            self._timer = asyncio.create_task(self._flush_later(delay))
        return True

    async def flush(self) -> None:
        """Send every held token now.

        Turn ends are covered without calling this: every turn ends with a
        terminal non-token event, which flushes first. The bridge calls it
        where a turn is cut short instead: shutdown preparation and teardown.
        """
        async with self._lock:
            await self._flush_locked()

    async def aclose(self) -> None:
        """Stop the trailing timer and send every held token."""
        timer = self._timer
        if timer is not None:
            timer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await timer
            # A timer cancelled before its first step never ran its finally.
            self._timer = None
        await self.flush()

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    def _near_size_limit(self, event: dict[str, Any]) -> bool:
        return event_size_bytes(event) + _ENVELOPE_HEADROOM_BYTES > MAX_EVENT_BYTES

    def _delay_seconds(self) -> float:
        if self._last_flush_at is None:
            return 0.0
        return self._interval_seconds - (self._clock() - self._last_flush_at)

    async def _flush_locked(self) -> None:
        if not self._pending:
            return
        pending, self._pending = self._pending, {}
        self._last_flush_at = self._clock()
        for event in pending.values():
            await self._send(event)

    async def _flush_later(self, delay: float) -> None:
        try:
            while True:
                await asyncio.sleep(delay)
                async with self._lock:
                    await self._flush_locked()
                # Tokens that arrived during the flush found this timer still
                # set and scheduled nothing, so they are this timer's to send.
                if not self._pending:
                    return
                delay = max(self._delay_seconds(), 0.0)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._log.warn("bridge.token_flush_error", exc=e, pending=len(self._pending))
        finally:
            self._timer = None
