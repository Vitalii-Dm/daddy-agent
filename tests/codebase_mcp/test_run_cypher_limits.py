"""Tests for the 500-row cap on :func:`run_cypher`."""

from __future__ import annotations

from typing import Any

from daddy_agent.codebase_mcp.server import RunCypherInput


def test_run_cypher_caps_at_500_rows(make_graph) -> None:
    rows = [{"i": i} for i in range(1_000)]

    def factory(q: str, p: dict[str, Any]) -> list[dict[str, Any]]:
        return rows

    graph = make_graph(factory)
    res = graph.run_cypher(RunCypherInput(query="MATCH (n) RETURN n"))

    assert res.row_count == 500
    assert len(res.rows) == 500
    assert res.truncated is True
    assert res.row_cap == 500
    # The first row is preserved; we do not shuffle.
    assert res.rows[0] == {"i": 0}
    assert res.rows[-1] == {"i": 499}


def test_run_cypher_row_count_honored_under_cap(make_graph) -> None:
    rows = [{"i": i} for i in range(17)]

    graph = make_graph(lambda q, p: rows)
    res = graph.run_cypher(RunCypherInput(query="MATCH (n) RETURN n"))

    assert res.row_count == 17
    assert res.truncated is False
    assert res.rows == rows


def test_run_cypher_exact_cap_not_marked_truncated(make_graph) -> None:
    rows = [{"i": i} for i in range(500)]
    graph = make_graph(lambda q, p: rows)
    res = graph.run_cypher(RunCypherInput(query="MATCH (n) RETURN n"))

    assert res.row_count == 500
    # Exactly the cap, nothing beyond — not truncated.
    assert res.truncated is False


def test_custom_row_cap(make_graph) -> None:
    rows = [{"i": i} for i in range(50)]
    graph = make_graph(lambda q, p: rows)
    graph.row_cap = 10

    res = graph.run_cypher(RunCypherInput(query="MATCH (n) RETURN n"))
    assert res.row_count == 10
    assert res.truncated is True
    assert res.row_cap == 10
