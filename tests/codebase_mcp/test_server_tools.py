"""Tests for the MCP tool handlers.

Every handler is invoked directly on a :class:`CodebaseGraph` wired to a
fake driver.  We assert on (a) the query sent to Neo4j, (b) the
parameters, and (c) the shape of the returned pydantic models.
"""

from __future__ import annotations

from typing import Any

import pytest

from daddy_agent.codebase_mcp import queries
from daddy_agent.codebase_mcp.safety import ReadOnlyViolation
from daddy_agent.codebase_mcp.server import (
    CodebaseGraph,
    CommunityInput,
    DependenciesInput,
    FindDeadCodeInput,
    ImpactAnalysisInput,
    NameLookupInput,
    RunCypherInput,
    SearchCodeInput,
)

# --------------------------------------------------------------------------- #
# search_code
# --------------------------------------------------------------------------- #


def test_search_code_shape_and_params(make_graph) -> None:
    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        assert "MATCH (n)" in q
        assert p == {"query": "auth", "limit": 5}
        return [
            {
                "kind": "Function",
                "name": "authenticate",
                "path": "src/auth.py",
                "line": 10,
                "docstring": "Log a user in.",
            },
            {
                "kind": "File",
                "name": "src/auth.py",
                "path": "src/auth.py",
                "line": 0,
                "docstring": "",
            },
        ]

    graph: CodebaseGraph = make_graph(factory)
    hits = graph.search_code(SearchCodeInput(query="auth", limit=5))

    assert len(hits) == 2
    assert hits[0].name == "authenticate"
    assert hits[0].kind == "Function"
    assert hits[1].path == "src/auth.py"

    session = graph.driver.sessions[0]
    assert session.database == "codebase"
    assert session.closed is True


# --------------------------------------------------------------------------- #
# get_callers / get_callees
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "method, expected_query",
    [
        ("get_callers", queries.GET_CALLERS),
        ("get_callees", queries.GET_CALLEES),
    ],
)
def test_caller_callee_tools(make_graph, method: str, expected_query: str) -> None:
    captured: dict[str, Any] = {}

    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        captured["q"] = q
        captured["p"] = p
        return [
            {
                "name": "foo",
                "file_path": "src/a.py",
                "line": 3,
                "signature": "def foo(x): ...",
            }
        ]

    graph: CodebaseGraph = make_graph(factory)
    refs = getattr(graph, method)(
        NameLookupInput(name="bar", file_path="src/b.py")
    )

    assert captured["q"] == expected_query
    assert captured["p"] == {"name": "bar", "file_path": "src/b.py"}
    assert len(refs) == 1
    assert refs[0].name == "foo"
    assert refs[0].signature.startswith("def foo")


def test_caller_handles_null_file_path(make_graph) -> None:
    seen: dict[str, Any] = {}

    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        seen.update(p)
        return []

    graph: CodebaseGraph = make_graph(factory)
    graph.get_callers(NameLookupInput(name="foo"))
    assert seen["file_path"] is None


# --------------------------------------------------------------------------- #
# get_dependencies
# --------------------------------------------------------------------------- #


def test_get_dependencies_inlines_depth(make_graph) -> None:
    captured: dict[str, Any] = {}

    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        captured["q"] = q
        captured["p"] = p
        return [{"kind": "Module", "name": "os", "depth": 1}]

    graph: CodebaseGraph = make_graph(factory)
    hits = graph.get_dependencies(
        DependenciesInput(file_path="src/auth.py", depth=3)
    )

    assert "[:IMPORTS*1..3]" in captured["q"]
    assert captured["p"] == {"file_path": "src/auth.py"}
    assert hits[0].kind == "Module"
    assert hits[0].depth == 1


def test_get_dependencies_rejects_bad_depth(make_graph) -> None:
    graph: CodebaseGraph = make_graph(lambda *_: [])
    with pytest.raises(Exception):
        graph.get_dependencies(
            DependenciesInput(file_path="x", depth=0)  # pydantic ge=1
        )


# --------------------------------------------------------------------------- #
# get_community
# --------------------------------------------------------------------------- #


def test_get_community_returns_none_when_missing(make_graph) -> None:
    graph: CodebaseGraph = make_graph(lambda *_: [])
    assert graph.get_community(CommunityInput(name="missing")) is None


def test_get_community_returns_info(make_graph) -> None:
    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        assert p == {"name": "UserService"}
        return [
            {
                "kind": "Class",
                "name": "UserService",
                "community_id": 7,
                "community_label": "users",
                "community_description": "user mgmt",
            }
        ]

    graph: CodebaseGraph = make_graph(factory)
    info = graph.get_community(CommunityInput(name="UserService"))
    assert info is not None
    assert info.community_id == 7
    assert info.community_label == "users"


# --------------------------------------------------------------------------- #
# impact_analysis
# --------------------------------------------------------------------------- #


def test_impact_analysis_groups_and_caps(make_graph) -> None:
    rows: list[dict[str, Any]] = []
    for i in range(3):
        rows.append(
            {"kind": "File", "name": f"src/f{i}.py", "file_path": f"src/f{i}.py"}
        )
    for i in range(2):
        rows.append(
            {
                "kind": "Function",
                "name": f"caller_{i}",
                "file_path": "src/a.py",
            }
        )

    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        assert p == {"file_path": "src/auth.py", "node_cap": 200}
        return rows

    graph: CodebaseGraph = make_graph(factory)
    report = graph.impact_analysis(
        ImpactAnalysisInput(file_path="src/auth.py")
    )

    assert len(report.files) == 3
    assert len(report.functions) == 2
    assert report.node_cap == 200
    assert report.truncated is False


def test_impact_analysis_truncates_when_cap_exceeded(make_graph) -> None:
    rows = [
        {"kind": "File", "name": f"f{i}.py", "file_path": f"f{i}.py"}
        for i in range(300)
    ]

    graph: CodebaseGraph = make_graph(lambda q, p: rows)
    report = graph.impact_analysis(
        ImpactAnalysisInput(file_path="src/auth.py")
    )
    assert report.truncated is True
    # files + functions == 200 (cap)
    assert len(report.files) + len(report.functions) == 200


# --------------------------------------------------------------------------- #
# find_dead_code
# --------------------------------------------------------------------------- #


def test_find_dead_code(make_graph) -> None:
    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        assert q == queries.FIND_DEAD_CODE
        assert p == {"limit": 500}
        return [
            {
                "name": "orphan",
                "file_path": "src/orphan.py",
                "line": 1,
                "signature": "def orphan(): ...",
            }
        ]

    graph: CodebaseGraph = make_graph(factory)
    hits = graph.find_dead_code(FindDeadCodeInput())
    assert len(hits) == 1
    assert hits[0].name == "orphan"


def test_find_dead_code_default_limit(make_graph) -> None:
    graph: CodebaseGraph = make_graph(lambda *_: [])
    graph.find_dead_code()
    session = graph.driver.sessions[0]
    assert session.calls[0]["parameters"] == {"limit": 500}


# --------------------------------------------------------------------------- #
# run_cypher
# --------------------------------------------------------------------------- #


def test_run_cypher_happy_path(make_graph) -> None:
    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        assert "MATCH" in q
        assert p == {"k": "v"}
        return [{"n": 1}, {"n": 2}]

    graph: CodebaseGraph = make_graph(factory)
    res = graph.run_cypher(
        RunCypherInput(query="MATCH (n) RETURN n", params={"k": "v"})
    )
    assert res.row_count == 2
    assert res.truncated is False
    assert res.rows == [{"n": 1}, {"n": 2}]


def test_run_cypher_rejects_mutation(make_graph) -> None:
    graph: CodebaseGraph = make_graph(lambda *_: [])
    with pytest.raises(ReadOnlyViolation):
        graph.run_cypher(RunCypherInput(query="CREATE (:X)"))

    # driver must never have been touched
    assert graph.driver.sessions == []


def test_run_cypher_rejects_apoc_mutation(make_graph) -> None:
    graph: CodebaseGraph = make_graph(lambda *_: [])
    with pytest.raises(ReadOnlyViolation):
        graph.run_cypher(
            RunCypherInput(query="CALL apoc.create.node(['X'], {})")
        )
