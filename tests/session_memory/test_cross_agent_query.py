"""Cross-agent query semantics test."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from daddy_agent.session_memory.lifecycle import (
    FakeMemoryBackend,
    cross_agent_query,
)


def test_cross_agent_query_excludes_caller_and_respects_since() -> None:
    backend = FakeMemoryBackend()
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=30)
    recent = now - timedelta(hours=1)

    backend.seeded_search_hits = [
        {"agent_id": "agent_a", "content": "a fact", "timestamp": recent},
        {"agent_id": "agent_b", "content": "b fact", "timestamp": recent},
        {"agent_id": "agent_b", "content": "old b fact", "timestamp": old},
        {"agent_id": "agent_c", "content": "c own fact", "timestamp": recent},
    ]

    hits = cross_agent_query(
        "what did the others learn?",
        agent_id="agent_c",
        since=now - timedelta(days=1),
        backend=backend,
    )

    # agent_c entries are filtered out; old b fact is dropped by ``since``.
    assert {h["agent_id"] for h in hits} == {"agent_a", "agent_b"}
    assert all("c own fact" not in h["content"] for h in hits)
    assert all(h["timestamp"] >= now - timedelta(days=1) for h in hits)

    assert backend.search_queries == [
        {
            "query": "what did the others learn?",
            "agent_id": "agent_c",
            "since": now - timedelta(days=1),
        }
    ]
