"""Temporal validity tests for :mod:`daddy_agent.session_memory.facts`."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from daddy_agent.session_memory.facts import (
    InMemoryFactStore,
    invalidate_fact,
    query_fact_history,
    store_fact,
)


def test_fact_history_returns_both_versions_in_order() -> None:
    store = InMemoryFactStore()
    t0 = datetime(2024, 1, 1, tzinfo=UTC)
    t1 = t0 + timedelta(days=30)
    t2 = t1 + timedelta(days=1)

    old = store_fact(
        "auth",
        "uses_algorithm",
        "RS256",
        valid_from=t0,
        store=store,
        fact_id="old",
    )
    store_fact(
        "auth",
        "uses_algorithm",
        "EdDSA",
        valid_from=t2,
        store=store,
        fact_id="new",
    )
    invalidate_fact(old.id, valid_until=t1, store=store)

    history = query_fact_history("auth", "uses_algorithm", store=store)

    assert [f.id for f in history] == ["old", "new"]
    assert history[0].object == "RS256"
    assert history[0].valid_until == t1
    assert history[1].object == "EdDSA"
    assert history[1].valid_until is None


def test_store_fact_uses_now_when_valid_from_missing() -> None:
    store = InMemoryFactStore()
    before = datetime.now(UTC)
    fact = store_fact("svc", "version", "1.0", store=store)
    after = datetime.now(UTC)
    assert before <= fact.valid_from <= after


def test_invalidate_unknown_fact_raises() -> None:
    store = InMemoryFactStore()
    try:
        invalidate_fact("does-not-exist", store=store)
    except KeyError:
        return
    raise AssertionError("KeyError expected")
