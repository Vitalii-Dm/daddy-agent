"""Tests for the Neo4j schema DDL."""

from __future__ import annotations

from daddy_agent.codebase_graph.schema import SCHEMA_STATEMENTS, apply_schema


def test_schema_statements_are_all_idempotent():
    # Every constraint/index must be ``IF NOT EXISTS`` so apply_schema can run
    # repeatedly on a live graph without error.
    assert SCHEMA_STATEMENTS
    for stmt in SCHEMA_STATEMENTS:
        assert "IF NOT EXISTS" in stmt, stmt


def test_schema_covers_required_nodes_and_relationships():
    joined = "\n".join(SCHEMA_STATEMENTS)
    for label in ("File", "Function", "Class", "Method", "Module", "Variable", "Community"):
        assert f":{label}" in joined, label
    for rel in ("CALLS", "GIT_COUPLED"):
        assert rel in joined, rel


def test_apply_schema_runs_every_statement(fake_session):
    executed = apply_schema(fake_session)
    assert executed == list(SCHEMA_STATEMENTS)
    queries = [call.query for call in fake_session.calls]
    assert queries == list(SCHEMA_STATEMENTS)
