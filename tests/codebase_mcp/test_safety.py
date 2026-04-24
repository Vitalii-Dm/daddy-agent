"""Tests for the read-only Cypher validator."""

from __future__ import annotations

import pytest

from daddy_agent.codebase_mcp.safety import (
    ReadOnlyViolation,
    ensure_read_only,
    validate_read_only_cypher,
)


# --------------------------------------------------------------------------- #
# Positive cases — queries that MUST pass
# --------------------------------------------------------------------------- #

READ_ONLY_QUERIES: list[str] = [
    "MATCH (n) RETURN n LIMIT 10",
    "MATCH (f:File)-[:IMPORTS]->(m:Module) RETURN f, m",
    # CTE / WITH
    "MATCH (f:File) WITH f ORDER BY f.path LIMIT 5 RETURN f.path",
    # CALL subquery that only reads
    """
    CALL {
      MATCH (fn:Function) RETURN fn LIMIT 3
    }
    RETURN fn.name
    """,
    # Read-only APOC procedure
    "CALL apoc.help('match') YIELD name RETURN name",
    # Comment-laden query
    """
    // grab all files
    /* block comment with SET / CREATE / DELETE words inside */
    MATCH (f:File)
    RETURN f.path  -- inline comment
    """,
    # String literal that looks like a mutation must not trip the guard
    "MATCH (n) WHERE n.note = 'CREATE node later' RETURN n",
    'MATCH (n) WHERE n.note = "SET in stone" RETURN n',
    # Backtick-quoted identifier containing CREATE
    "MATCH (`CREATE`:File) RETURN `CREATE`",
    # UNION ALL of reads
    "MATCH (a) RETURN a UNION ALL MATCH (b) RETURN b",
    # OPTIONAL MATCH with complex WHERE
    (
        "MATCH (f:File) "
        "OPTIONAL MATCH (f)-[:IMPORTS]->(m) "
        "RETURN f, collect(m) AS mods"
    ),
    # UNWIND + WITH
    "UNWIND [1,2,3] AS x WITH x WHERE x > 1 RETURN x",
    # CALL ... YIELD subquery on read-only procedure
    "CALL db.labels() YIELD label RETURN label",
]


@pytest.mark.parametrize("query", READ_ONLY_QUERIES)
def test_read_only_queries_pass(query: str) -> None:
    result = validate_read_only_cypher(query)
    assert result.ok, f"should pass: {query!r} ({result.reason})"
    ensure_read_only(query)  # must not raise


# --------------------------------------------------------------------------- #
# Negative cases — queries that MUST be rejected
# --------------------------------------------------------------------------- #

MUTATING_QUERIES: list[tuple[str, str]] = [
    ("CREATE (n:File {path: 'x'})", "CREATE"),
    ("MATCH (n) DELETE n", "DELETE"),
    ("MATCH (n) DETACH DELETE n", "DETACH"),
    ("MERGE (n:Module {name: 'x'})", "MERGE"),
    ("MATCH (n) SET n.foo = 1", "SET"),
    ("MATCH (n) REMOVE n.foo", "REMOVE"),
    ("DROP INDEX foo", "DROP"),
    ("LOAD CSV FROM 'x' AS row RETURN row", "LOAD"),
    ("FOREACH (x IN [1,2] | CREATE (:N))", "FOREACH"),
    ("USING PERIODIC COMMIT 500 LOAD CSV FROM 'x' AS r RETURN r", "LOAD"),
    # Mutation inside a CALL subquery
    (
        "CALL { CREATE (:File {path: 'x'}) } RETURN 1",
        "CREATE",
    ),
    # Mutation hidden after a comment
    (
        "// read-only please\nCREATE (:Foo)",
        "CREATE",
    ),
    # Mutation after a block comment
    (
        "/* harmless */ MATCH (n) /* still fine */ DELETE n",
        "DELETE",
    ),
    # Multi-statement — mutation in second statement
    (
        "MATCH (n) RETURN n; CREATE (:X);",
        "CREATE",
    ),
    # ON MATCH SET (part of MERGE semantics) — SET still triggers
    (
        "MATCH (n) WITH n ORDER BY n.name LIMIT 1 SET n.touched = 1",
        "SET",
    ),
    # Whitespace trickery
    ("  \n\t CREATE (:A)", "CREATE"),
    # Mixed-case
    ("cReAtE (:A)", "CREATE"),
    # APOC mutation procedures
    ("CALL apoc.create.node(['X'], {})", "apoc.create"),
    ("CALL apoc.merge.node(['X'], {}, {}, {})", "apoc.merge"),
    ("CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'DELETE n', {})",
     "apoc.periodic"),
    ("CALL apoc.refactor.rename.label('Old', 'New')", "apoc.refactor"),
    # GDS mutation
    ("CALL gds.graph.project('g', 'File', 'IMPORTS')", "gds.graph.project"),
    ("CALL gds.pageRank.write('g', {})", ".write"),
    # Case-insensitive CALL with mixed-case procedure
    ("call Apoc.Create.Node(['X'], {})", "apoc.create"),
    # Extra whitespace between CALL and procedure name
    ("CALL    apoc.create.node(['X'], {})", "apoc.create"),
    # Bare procedure reference (no CALL) — still rejected
    ("RETURN apoc.create.uuid()", "apoc.create"),
    # Empty / whitespace queries
    ("", "empty"),
    ("   \n\t  ", "empty"),
]


@pytest.mark.parametrize("query,needle", MUTATING_QUERIES)
def test_mutating_queries_rejected(query: str, needle: str) -> None:
    result = validate_read_only_cypher(query)
    assert not result.ok, f"should fail: {query!r}"
    assert result.reason is not None
    assert needle.lower() in result.reason.lower(), (
        f"reason {result.reason!r} should mention {needle!r}"
    )
    with pytest.raises(ReadOnlyViolation):
        ensure_read_only(query)


def test_non_string_query_rejected() -> None:
    result = validate_read_only_cypher(None)  # type: ignore[arg-type]
    assert not result.ok


def test_backtick_identifier_does_not_mask_real_mutation() -> None:
    # A backticked identifier followed by a real CREATE must still fail.
    result = validate_read_only_cypher(
        "MATCH (`n`:File) WITH `n` CREATE (:Other)"
    )
    assert not result.ok
    assert "CREATE" in (result.reason or "")


def test_string_literal_does_not_mask_real_mutation() -> None:
    result = validate_read_only_cypher(
        "MATCH (n {note: 'safe DELETE'}) DELETE n"
    )
    assert not result.ok
    assert "DELETE" in (result.reason or "").upper() or "DETACH" in (
        result.reason or ""
    ).upper()
