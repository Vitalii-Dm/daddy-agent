"""SSE heartbeat / graph-updated event tests.

Uses an injectable synchronous ticker to drive the stream forward without
actually sleeping. We read a bounded number of bytes to assert shape.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.viz.conftest import FakeRecord


def _make_app(counts):
    """Build an app whose COUNT(*) query returns successive values from ``counts``."""
    from daddy_agent.viz.server import DriverFactory, create_app
    from tests.viz.conftest import FakeDriver

    idx = {"i": 0}

    def handler(cypher: str, params: dict[str, Any]) -> list[FakeRecord]:
        assert "count" in cypher.lower()
        i = idx["i"]
        idx["i"] += 1
        # Cycle through the user-supplied list, clamped to last value.
        value = counts[min(i, len(counts) - 1)]
        return [FakeRecord({"c": value})]

    factory = DriverFactory()
    factory._driver = FakeDriver(handler)  # type: ignore[attr-defined]

    def ticker():
        # Fire a fixed number of ticks so the stream terminates.
        for _ in range(3):
            yield None

    app = create_app(factory, ticker=ticker)
    return app


def test_sse_emits_heartbeat_and_graph_updated():
    # Each tick touches both databases -> 2 queries per tick -> pairs of counts
    app = _make_app([0, 0, 1, 1, 2, 2])
    client = TestClient(app)
    with client.stream("GET", "/events") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = b"".join(resp.iter_bytes())
    text = body.decode("utf-8")
    # Heartbeats (SSE comments) present
    assert text.count(": heartbeat") >= 1
    # A graph-updated event fires at least once (first observation is always "new")
    assert "event: graph-updated" in text
    assert "signature" in text


def test_sse_no_event_when_signature_unchanged():
    # Hold counts steady -> only the first tick produces a graph-updated event.
    app = _make_app([5, 5])
    client = TestClient(app)
    with client.stream("GET", "/events") as resp:
        body = b"".join(resp.iter_bytes())
    text = body.decode("utf-8")
    assert text.count("event: graph-updated") == 1
    # But heartbeats for every tick
    assert text.count(": heartbeat") >= 3


def test_sse_emits_error_event_when_db_down():
    """Pin: round-2 fix lets _signature raise so the SSE loop emits
    `event: error`. Without this, a dead Neo4j looked identical to a
    quiet graph (stale -1/-1 sentinel, no feedback to clients)."""

    from daddy_agent.viz.server import DriverFactory, create_app
    from tests.viz.conftest import FakeDriver

    def boom_handler(cypher: str, params: dict[str, Any]) -> list[FakeRecord]:
        raise RuntimeError("neo4j unreachable")

    factory = DriverFactory()
    factory._driver = FakeDriver(boom_handler)  # type: ignore[attr-defined]

    def ticker():
        for _ in range(2):
            yield None

    app = create_app(factory, ticker=ticker)
    client = TestClient(app)
    with client.stream("GET", "/events") as resp:
        assert resp.status_code == 200
        body = b"".join(resp.iter_bytes())
    text = body.decode("utf-8")
    assert "event: error" in text, "expected an SSE error event when DB raises"
    assert "neo4j unreachable" in text, "error reason should be surfaced to client"
    # Heartbeats keep flowing — the stream must stay open so the client can
    # observe recovery on a later tick.
    assert ": heartbeat" in text
