"""Tests for the session lifecycle helpers using :class:`FakeMemoryBackend`."""

from __future__ import annotations

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
