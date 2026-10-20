"""Tests for the fork-only token coalescer in front of the event forwarder."""

import asyncio
from typing import Any
from unittest.mock import MagicMock

from sandbox_runtime.event_size import MAX_EVENT_BYTES
from sandbox_runtime.token_coalescer import TOKEN_COALESCE_INTERVAL_SECONDS as INTERVAL
from sandbox_runtime.token_coalescer import TokenCoalescer


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class Recorder:
    def __init__(self, result: bool = True) -> None:
        self.events: list[dict[str, Any]] = []
        self.result = result

    async def __call__(self, event: dict[str, Any]) -> bool:
        self.events.append(event)
        return self.result

    def contents(self) -> list[tuple[str, str | None]]:
        return [(event["type"], event.get("content")) for event in self.events]


def token(content: str, *, message_id: str = "msg-1", part_id: str | None = None) -> dict:
    event = {"type": "token", "messageId": message_id, "content": content}
    if part_id is not None:
        event["partId"] = part_id
    return event


def make(
    recorder: Recorder, clock: Clock | None = None, interval: float = INTERVAL
) -> TokenCoalescer:
    kwargs: dict[str, Any] = {"log": MagicMock(), "interval_seconds": interval}
    if clock is not None:
        kwargs["clock"] = clock
    return TokenCoalescer(recorder, **kwargs)


async def test_first_token_goes_out_at_once_and_later_ones_keep_only_the_latest():
    recorder, clock = Recorder(), Clock()
    coalescer = make(recorder, clock)

    assert await coalescer.send(token("H")) is True
    assert await coalescer.send(token("He")) is True
    assert await coalescer.send(token("Hel")) is True

    assert recorder.contents() == [("token", "H")]
    assert coalescer.pending_count == 1
    await coalescer.flush()
    assert recorder.contents() == [("token", "H"), ("token", "Hel")]


async def test_a_token_after_a_quiet_interval_is_not_held():
    recorder, clock = Recorder(), Clock()
    coalescer = make(recorder, clock)

    await coalescer.send(token("a"))
    clock.advance(INTERVAL)
    await coalescer.send(token("ab"))

    assert recorder.contents() == [("token", "a"), ("token", "ab")]
    assert coalescer.pending_count == 0


async def test_a_non_token_event_flushes_held_tokens_first():
    recorder, clock = Recorder(), Clock()
    coalescer = make(recorder, clock)

    await coalescer.send(token("a"))
    await coalescer.send(token("ab"))
    await coalescer.send({"type": "tool_call", "messageId": "msg-1", "callId": "c1"})

    assert recorder.contents() == [("token", "a"), ("token", "ab"), ("tool_call", None)]


async def test_execution_complete_carries_the_final_text_ahead_of_it():
    recorder, clock = Recorder(), Clock()
    coalescer = make(recorder, clock)

    await coalescer.send(token("Done"))
    await coalescer.send(token("Done."))
    await coalescer.send({"type": "execution_complete", "messageId": "msg-1", "success": True})

    assert recorder.contents()[-2:] == [("token", "Done."), ("execution_complete", None)]


async def test_the_trailing_flush_sends_the_final_text_with_no_later_event():
    recorder = Recorder()
    coalescer = make(recorder, interval=0.01)

    await coalescer.send(token("a"))
    await coalescer.send(token("ab"))
    await coalescer.send(token("abc"))

    await asyncio.wait_for(_until(lambda: recorder.contents()[-1] == ("token", "abc")), 1.0)
    assert recorder.contents() == [("token", "a"), ("token", "abc")]


async def test_tokens_arriving_during_a_trailing_flush_are_still_sent():
    release = asyncio.Event()
    sent: list[str] = []

    async def slow_send(event: dict[str, Any]) -> bool:
        if event["content"] == "ab":
            await release.wait()
        sent.append(event["content"])
        return True

    coalescer = TokenCoalescer(slow_send, log=MagicMock(), interval_seconds=0.01)
    await coalescer.send(token("a"))
    await coalescer.send(token("ab"))
    await asyncio.wait_for(_until(lambda: coalescer.pending_count == 0), 1.0)
    # The trailing flush is parked sending "ab"; "abc" arrives meanwhile.
    await coalescer.send(token("abc"))
    release.set()

    await asyncio.wait_for(_until(lambda: sent[-1:] == ["abc"]), 1.0)
    assert sent == ["a", "ab", "abc"]


async def test_different_parts_and_messages_do_not_overwrite_each_other():
    recorder, clock = Recorder(), Clock()
    coalescer = make(recorder, clock)

    await coalescer.send(token("x"))
    await coalescer.send(token("p1", part_id="part-1"))
    await coalescer.send(token("p2", part_id="part-2"))
    await coalescer.send(token("p1+", part_id="part-1"))
    await coalescer.send(token("other", message_id="msg-2"))
    await coalescer.flush()

    flushed = [(e.get("messageId"), e.get("partId"), e["content"]) for e in recorder.events[1:]]
    assert sorted(flushed, key=str) == sorted(
        [("msg-1", "part-1", "p1+"), ("msg-1", "part-2", "p2"), ("msg-2", None, "other")],
        key=str,
    )


async def test_a_token_near_the_size_limit_is_never_held_so_its_refusal_is_reported():
    recorder, clock = Recorder(result=False), Clock()
    coalescer = make(recorder, clock)
    await coalescer.send(token("opening"))
    await coalescer.send(token("opening more"))

    oversized = token("x" * MAX_EVENT_BYTES)
    assert await coalescer.send(oversized) is False

    # The held frame went out first, then the oversized one, in order.
    assert [event["content"] for event in recorder.events] == [
        "opening",
        "opening more",
        oversized["content"],
    ]


async def test_aclose_sends_held_tokens_and_later_tokens_still_flush():
    recorder = Recorder()
    coalescer = make(recorder, interval=0.01)
    await coalescer.send(token("a"))
    await coalescer.send(token("ab"))

    await coalescer.aclose()
    assert recorder.contents() == [("token", "a"), ("token", "ab")]

    # A token held after close still gets its trailing flush.
    await coalescer.send(token("abc"))
    await asyncio.wait_for(_until(lambda: recorder.contents()[-1] == ("token", "abc")), 1.0)


async def _until(predicate) -> None:
    while not predicate():
        await asyncio.sleep(0.001)
