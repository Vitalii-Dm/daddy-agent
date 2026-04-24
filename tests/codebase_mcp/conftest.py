"""Shared fixtures for the codebase-MCP test suite.

We do not want pytest to import a real Neo4j driver — everything is
mocked via small stand-in classes that mimic the slice of the interface
:mod:`daddy_agent.codebase_mcp.server` actually uses (``session.run``,
``result`` iteration, ``record.data()``, ``session.close()``).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

import pytest

# Make ``src/`` importable without installing the package.
_SRC = Path(__file__).resolve().parents[2] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


@dataclass
class FakeRecord:
    """Mimics ``neo4j.Record``."""

    payload: dict[str, Any]

    def data(self) -> dict[str, Any]:
        return dict(self.payload)


@dataclass
class FakeResult:
    """Iterable of :class:`FakeRecord`.  Mirrors ``neo4j.Result``."""

    records: list[FakeRecord]

    def __iter__(self) -> Iterable[FakeRecord]:
        return iter(self.records)


@dataclass
class FakeSession:
    """Mimics ``neo4j.Session``.

    Records every ``run`` invocation for later inspection and returns a
    canned :class:`FakeResult` produced by a user-supplied
    ``response_factory`` — the tests use this to shape per-query output.
    """

    response_factory: Callable[[str, dict[str, Any]], list[dict[str, Any]]]
    database: str = "codebase"
    calls: list[dict[str, Any]] = field(default_factory=list)
    closed: bool = False

    def run(
        self,
        query: str,
        parameters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> FakeResult:
        params = dict(parameters or {})
        params.update(kwargs)
        self.calls.append(
            {"query": query, "parameters": params, "database": self.database}
        )
        rows = self.response_factory(query, params)
        return FakeResult([FakeRecord(r) for r in rows])

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeDriver:
    """Driver stub that hands out :class:`FakeSession` instances."""

    response_factory: Callable[[str, dict[str, Any]], list[dict[str, Any]]]
    sessions: list[FakeSession] = field(default_factory=list)

    def session(self, database: str = "codebase") -> FakeSession:
        session = FakeSession(self.response_factory, database=database)
        self.sessions.append(session)
        return session


@pytest.fixture
def fake_driver_factory() -> Callable[
    [Callable[[str, dict[str, Any]], list[dict[str, Any]]]], FakeDriver
]:
    """Return a factory building :class:`FakeDriver` instances."""

    def _factory(
        response_factory: Callable[
            [str, dict[str, Any]], list[dict[str, Any]]
        ],
    ) -> FakeDriver:
        return FakeDriver(response_factory)

    return _factory


@pytest.fixture
def make_graph(
    fake_driver_factory: Callable[
        [Callable[[str, dict[str, Any]], list[dict[str, Any]]]], FakeDriver
    ],
) -> Callable[
    [Callable[[str, dict[str, Any]], list[dict[str, Any]]]], Any
]:
    """Build a ``CodebaseGraph`` bound to a :class:`FakeDriver`."""
    from daddy_agent.codebase_mcp.server import CodebaseGraph

    def _factory(
        response_factory: Callable[
            [str, dict[str, Any]], list[dict[str, Any]]
        ],
    ) -> CodebaseGraph:
        driver = fake_driver_factory(response_factory)
        return CodebaseGraph(driver=driver, database="codebase", row_cap=500)

    return _factory
