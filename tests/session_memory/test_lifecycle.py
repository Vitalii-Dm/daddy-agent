"""Tests for the session lifecycle helpers using :class:`FakeMemoryBackend`."""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

from daddy_agent.session_memory.lifecycle import (
    ContextBundle,
    FakeMemoryBackend,
    ToolCallLog,
    cross_agent_query,
    end_session,
    log_message,
    log_reasoning,
    pull_context,
    start_session,
)


def _wait_for(predicate, *, timeout: float = 1.0) -> None:
    """Poll ``predicate`` for up to ``timeout`` seconds.

    The log helpers are fire-and-forget on a daemon thread so tests must
    wait for the write to land before asserting.
    """

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError("condition not reached within timeout")


def test_start_and_end_session_round_trip() -> None:
    backend = FakeMemoryBackend()
    handle = start_session("worker-1", "pane-%0", "build the parser", backend=backend)

    assert handle.agent_id == "worker-1"
    assert handle.pane_id == "pane-%0"
    assert handle.task == "build the parser"
    assert handle.closed is False
    assert len(backend.sessions) == 1
    assert backend.sessions[0]["session_id"] == handle.session_id
    assert backend.sessions[0]["agent_id"] == "worker-1"

    end_session(handle, summary="parser built")
    assert handle.closed is True
    assert backend.ended_sessions == [
        {"session_id": handle.session_id, "summary": "parser built"}
    ]

    # Double-end is a no-op.
    end_session(handle, summary="ignored")
    assert len(backend.ended_sessions) == 1


def test_end_session_auto_summary() -> None:
    backend = FakeMemoryBackend()
    handle = start_session("w", "p", "ship the feature", backend=backend)
    end_session(handle)
    assert backend.ended_sessions[0]["summary"] == "Session for task: ship the feature"


def test_log_message_records_payload_async() -> None:
    backend = FakeMemoryBackend()
    handle = start_session("w", "p", "t", backend=backend)
    log_message(handle, "assistant", "hello")

    _wait_for(lambda: len(backend.messages) == 1)
    msg = backend.messages[0]
    assert msg["session_id"] == handle.session_id
    assert msg["role"] == "assistant"
    assert msg["content"] == "hello"
    assert isinstance(msg["timestamp"], datetime)
    assert msg["timestamp"].tzinfo is UTC


def test_log_reasoning_serialises_tool_calls() -> None:
    backend = FakeMemoryBackend()
    handle = start_session("w", "p", "t", backend=backend)
    log_reasoning(
        handle,
        goal="choose db",
        outcome="postgres",
        tool_calls=[
            ToolCallLog(
                name="search_code",
                input={"q": "db"},
                output={"n": 3},
                duration_ms=12.5,
            )
        ],
    )
    _wait_for(lambda: len(backend.reasoning) == 1)
    trace = backend.reasoning[0]
    assert trace["goal"] == "choose db"
    assert trace["outcome"] == "postgres"
    assert trace["tool_calls"] == [
        {
            "name": "search_code",
            "input": {"q": "db"},
            "output": {"n": 3},
            "duration_ms": 12.5,
            "success": True,
        }
    ]


def test_pull_context_respects_top_k() -> None:
    backend = FakeMemoryBackend()
    backend.seeded_context = {
        "messages": [{"i": i} for i in range(10)],
        "entities": [{"i": i} for i in range(10)],
        "reasoning": [{"i": i} for i in range(10)],
    }

    bundle = pull_context("task", top_k=3, backend=backend)

    assert isinstance(bundle, ContextBundle)
    assert len(bundle.messages) == 3
    assert len(bundle.entities) == 3
    assert len(bundle.reasoning) == 3
    assert bundle.total() == 9
    assert backend.context_queries == [{"task": "task", "top_k": 3}]


def test_cross_agent_query_filters_caller() -> None:
    backend = FakeMemoryBackend()
    backend.seeded_search_hits = [
        {"agent_id": "a", "content": "from a"},
        {"agent_id": "b", "content": "from b"},
        {"agent_id": "c", "content": "from c"},
    ]
    out = cross_agent_query("question", agent_id="a", backend=backend)
    assert {h["agent_id"] for h in out} == {"b", "c"}
    assert backend.search_queries == [
        {"query": "question", "agent_id": "a", "since": None}
    ]


# --------------------------------------------------------------------------- #
# Regression pins for round-2 flush / exception-logging fixes
# --------------------------------------------------------------------------- #


class _SlowBackend(FakeMemoryBackend):
    """FakeMemoryBackend whose add_message sleeps before recording.

    Used to catch regressions where end_session forgets to call flush() —
    without flush, the final log_message's daemon thread is still sleeping
    when end_session returns, and the message never lands.
    """

    def __init__(self, delay: float = 0.05) -> None:
        super().__init__()
        self.delay = delay

    def add_message(self, *, session_id, role, content, timestamp) -> None:  # type: ignore[override]
        time.sleep(self.delay)
        super().add_message(
            session_id=session_id,
            role=role,
            content=content,
            timestamp=timestamp,
        )


def test_end_session_drains_pending_async_writes() -> None:
    """Pin: end_session must flush before returning; otherwise a write
    scheduled in the final ms of the session would be lost at exit."""

    backend = _SlowBackend(delay=0.05)
    handle = start_session("w1", "p0", "task", backend=backend)
    log_message(handle, "user", "last words")
    end_session(handle)
    # flush inside end_session must have joined the daemon thread already.
    assert len(backend.messages) == 1, (
        "end_session returned before the async write landed — flush() missing?"
    )


def test_fire_and_forget_logs_exceptions(caplog) -> None:
    """Pin: exceptions in async writes must be logged via stdlib logging,
    not silently swallowed (round-2 fix requirement)."""

    class ExplodingBackend(FakeMemoryBackend):
        def add_message(self, **_: object) -> None:  # type: ignore[override]
            raise RuntimeError("neo4j down")

    backend = ExplodingBackend()
    handle = start_session("w1", "p0", "task", backend=backend)
    with caplog.at_level(logging.ERROR, logger="daddy_agent.session_memory.lifecycle"):
        log_message(handle, "user", "hello")
        # Drain: end_session calls flush internally; without waiting here
        # caplog may race the daemon thread.
        end_session(handle)
    assert any(
        "async memory write failed" in rec.message for rec in caplog.records
    ), f"expected async-write error in log; saw {[r.message for r in caplog.records]!r}"
