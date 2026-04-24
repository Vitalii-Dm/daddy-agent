"""Shared fixtures for viz tests.

Provides a lightweight fake Neo4j driver so the server and exporter tests
run entirely offline.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import pytest

# Put the repo's ``src`` on sys.path so tests can import daddy_agent.
SRC = Path(__file__).resolve().parents[2] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


# ---------------------------------------------------------------------------
# Fake neo4j primitives
# ---------------------------------------------------------------------------


@dataclass
class FakeNode:
    id: int
    labels: List[str]
    properties: Dict[str, Any]

    @property
    def element_id(self) -> str:
        return f"n:{self.id}"

    def __iter__(self):
        return iter(self.properties)

    def keys(self):
        return self.properties.keys()

    def __getitem__(self, key: str) -> Any:
        return self.properties[key]


@dataclass
class FakeRel:
    id: int
    type: str
    start_node: FakeNode
    end_node: FakeNode
    properties: Dict[str, Any] = field(default_factory=dict)

    @property
    def element_id(self) -> str:
        return f"r:{self.id}"

    def __iter__(self):
        return iter(self.properties)

    def keys(self):
        return self.properties.keys()

    def __getitem__(self, key: str) -> Any:
        return self.properties[key]


@dataclass
class FakeRecord:
    data: Dict[str, Any]

    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def keys(self):
        return self.data.keys()

    def __iter__(self):
        return iter(self.data.values())


class FakeResult:
    def __init__(self, records: List[FakeRecord]):
        self._records = records

    def __iter__(self):
        return iter(self._records)


class FakeSession:
    def __init__(self, handler: Callable[[str, Dict[str, Any]], List[FakeRecord]], database: Optional[str] = None):
        self._handler = handler
        self.database = database
        self.calls: List[Dict[str, Any]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def run(self, cypher: str, **params: Any) -> FakeResult:
        self.calls.append({"cypher": cypher, "params": params, "database": self.database})
        return FakeResult(self._handler(cypher, params))


class FakeDriver:
    def __init__(self, handler: Callable[[str, Dict[str, Any]], List[FakeRecord]]):
        self._handler = handler
        self.sessions: List[FakeSession] = []
        self.connectivity_checked = 0

    def session(self, database: Optional[str] = None, **kwargs):
        s = FakeSession(self._handler, database=database)
        self.sessions.append(s)
        return s

    def verify_connectivity(self) -> None:
        self.connectivity_checked += 1

    def close(self) -> None:
        pass


@pytest.fixture
def fake_driver_factory():
    """Return a builder that wraps a handler into a ``DriverFactory``-compat object."""
    from daddy_agent.viz.server import DriverFactory

    def _build(handler: Callable[[str, Dict[str, Any]], List[FakeRecord]]) -> DriverFactory:
        factory = DriverFactory()
        driver = FakeDriver(handler)
        factory._driver = driver  # type: ignore[attr-defined]
        factory._fake = driver  # type: ignore[attr-defined]
        return factory

    return _build


@pytest.fixture
def sample_graph():
    """Tiny hand-crafted graph used across multiple tests."""
    file_a = FakeNode(1, ["File"], {"name": "a.py", "path": "a.py", "community": "core"})
    file_b = FakeNode(2, ["File"], {"name": "b.py", "path": "b.py", "community": "core"})
    func = FakeNode(3, ["Function"], {"name": "process", "community": "core", "signature": "process()"})
    entity = FakeNode(4, ["Entity"], {"name": "JWT", "community": "security", "summary": "JSON Web Token"})
    rel_import = FakeRel(10, "IMPORTS", file_a, file_b, {})
    rel_defines = FakeRel(11, "DEFINES", file_a, func, {})
    return {
        "nodes": [file_a, file_b, func, entity],
        "edges": [rel_import, rel_defines],
    }


__all__ = [
    "FakeNode",
    "FakeRel",
    "FakeRecord",
    "FakeResult",
    "FakeSession",
    "FakeDriver",
]
