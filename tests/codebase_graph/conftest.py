"""Shared fixtures for codebase-graph tests."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest


@dataclass
class RecordedCall:
    """A single captured ``session.run()`` invocation."""

    query: str
    params: dict[str, Any]


@dataclass
class FakeSession:
    """Minimal stand-in for :class:`neo4j.Session` used by the tests.

    Records every Cypher call and returns a configurable result set so we can
    exercise the ingester / indexer without a running Neo4j.
    """

    calls: list[RecordedCall] = field(default_factory=list)
    query_results: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    closed: bool = False

    def run(self, query: str, **params: Any) -> list[dict[str, Any]]:  # noqa: D401
        """Record call and return preconfigured rows."""

        self.calls.append(RecordedCall(query=query, params=params))
        # Match by substring to keep tests from depending on exact formatting.
        for key, rows in self.query_results.items():
            if key in query:
                return list(rows)
        return []

    def close(self) -> None:
        self.closed = True

    # Helpers used by assertions -------------------------------------------------
    def queries_containing(self, needle: str) -> list[RecordedCall]:
        return [c for c in self.calls if needle in c.query]


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


@pytest.fixture
def fake_session() -> FakeSession:
    return FakeSession()
