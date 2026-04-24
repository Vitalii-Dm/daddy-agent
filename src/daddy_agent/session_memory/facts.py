"""Temporal-validity fact helpers.

The session-memory schema stores facts as :subject-[RELATES_TO]->:object with
``valid_from`` and ``valid_until`` timestamps. This module provides a thin
API that agents can use without writing Cypher:

* :func:`store_fact` — create a new fact version, optionally superseding the
  current one.
* :func:`invalidate_fact` — stamp ``valid_until`` on an existing fact.
* :func:`query_fact_history` — return every version of ``(subject, predicate)``
  sorted by ``valid_from``.

A :class:`FactStore` protocol mirrors the subset of the real backend we need
so tests can inject :class:`InMemoryFactStore`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

__all__ = [
    "Fact",
    "FactStore",
    "InMemoryFactStore",
    "invalidate_fact",
    "query_fact_history",
    "store_fact",
]


@dataclass
class Fact:
    """A single versioned fact."""

    id: str
    subject: str
    predicate: str
    object: str
    valid_from: datetime
    valid_until: datetime | None = None
    extra: dict[str, object] = field(default_factory=dict)


@runtime_checkable
class FactStore(Protocol):
    """Storage protocol for facts. The real backend writes Cypher."""

    def write_fact(self, fact: Fact) -> None: ...

    def set_valid_until(self, fact_id: str, valid_until: datetime) -> Fact: ...

    def list_facts(self, subject: str, predicate: str) -> list[Fact]: ...


class InMemoryFactStore:
    """Simple in-memory :class:`FactStore` implementation.

    Used by tests and as a reference for the real Neo4j-backed version.
    """

    def __init__(self) -> None:
        self._facts: dict[str, Fact] = {}

    def write_fact(self, fact: Fact) -> None:
        self._facts[fact.id] = fact

    def set_valid_until(self, fact_id: str, valid_until: datetime) -> Fact:
        if fact_id not in self._facts:
            raise KeyError(fact_id)
        fact = self._facts[fact_id]
        updated = Fact(
            id=fact.id,
            subject=fact.subject,
            predicate=fact.predicate,
            object=fact.object,
            valid_from=fact.valid_from,
            valid_until=valid_until,
            extra=dict(fact.extra),
        )
        self._facts[fact_id] = updated
        return updated

    def list_facts(self, subject: str, predicate: str) -> list[Fact]:
        return [
            f
            for f in self._facts.values()
            if f.subject == subject and f.predicate == predicate
        ]


def _now() -> datetime:
    return datetime.now(tz=UTC)


def store_fact(
    subject: str,
    predicate: str,
    object: str,
    *,
    valid_from: datetime | None = None,
    store: FactStore,
    fact_id: str | None = None,
) -> Fact:
    """Insert a new fact version.

    The caller is responsible for invalidating the previous version if the new
    fact supersedes it — we keep the two steps explicit so an agent can decide
    whether the new info *replaces* or *coexists with* the old info.
    """

    fact = Fact(
        id=fact_id or str(uuid.uuid4()),
        subject=subject,
        predicate=predicate,
        object=object,
        valid_from=valid_from or _now(),
    )
    store.write_fact(fact)
    return fact


def invalidate_fact(
    fact_id: str,
    *,
    valid_until: datetime | None = None,
    store: FactStore,
) -> Fact:
    """Mark ``fact_id`` as no longer valid as of ``valid_until``.

    The old fact is not deleted — the plan is clear that old facts are
    *preserved* so temporal queries still work.
    """

    return store.set_valid_until(fact_id, valid_until or _now())


def query_fact_history(
    subject: str,
    predicate: str,
    *,
    store: FactStore,
) -> list[Fact]:
    """Return every version of ``(subject, predicate)`` ordered by ``valid_from``.

    Both current and invalidated versions are returned; callers can filter on
    ``valid_until`` if they only want the currently-valid entry.
    """

    return sorted(store.list_facts(subject, predicate), key=lambda f: f.valid_from)
