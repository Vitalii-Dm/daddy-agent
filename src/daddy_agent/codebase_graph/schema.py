"""Neo4j schema for the codebase knowledge graph.

All statements are idempotent (``IF NOT EXISTS``) so :func:`apply_schema` can be
called on every startup without clobbering an existing graph.

The schema mirrors the design in ``PLAN-neo4j-knowledge-graphs.md``:

* Node types emitted today: ``File``, ``Function``, ``Class``, ``Method``,
  ``Module``.  ``Variable`` and ``Community`` constraints are declared for
  forward-compat but no code currently writes them — those belong to a
  later community-detection + variable-tracking pass.
* Relationship types emitted today: ``CALLS``, ``IMPORTS``, ``EXTENDS``,
  ``IMPLEMENTS``, ``HAS_METHOD``, ``HAS_FUNCTION``, ``HAS_CLASS``,
  ``GIT_COUPLED``.  ``USES`` and ``BELONGS_TO`` are placeholders (same
  pass as above).

``File.hash`` stores sha256 of the file's bytes so the incremental indexer
can diff without a side database — see :mod:`daddy_agent.codebase_graph.indexer`.
"""

from __future__ import annotations

from collections.abc import Iterable

# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------

# ``File`` is keyed by its repo-relative path. Every other node is keyed by a
# synthetic ``qualified_name`` so that e.g. two methods named ``run`` on
# different classes don't collide.
CONSTRAINTS: tuple[str, ...] = (
    "CREATE CONSTRAINT file_path IF NOT EXISTS "
    "FOR (f:File) REQUIRE f.path IS UNIQUE",
    "CREATE CONSTRAINT function_qname IF NOT EXISTS "
    "FOR (fn:Function) REQUIRE fn.qualified_name IS UNIQUE",
    "CREATE CONSTRAINT class_qname IF NOT EXISTS "
    "FOR (c:Class) REQUIRE c.qualified_name IS UNIQUE",
    "CREATE CONSTRAINT method_qname IF NOT EXISTS "
    "FOR (m:Method) REQUIRE m.qualified_name IS UNIQUE",
    "CREATE CONSTRAINT module_name IF NOT EXISTS "
    "FOR (m:Module) REQUIRE m.name IS UNIQUE",
    "CREATE CONSTRAINT variable_qname IF NOT EXISTS "
    "FOR (v:Variable) REQUIRE v.qualified_name IS UNIQUE",
    "CREATE CONSTRAINT community_id IF NOT EXISTS "
    "FOR (c:Community) REQUIRE c.id IS UNIQUE",
)

# ---------------------------------------------------------------------------
# Indexes
# ---------------------------------------------------------------------------

INDEXES: tuple[str, ...] = (
    "CREATE INDEX file_language IF NOT EXISTS FOR (f:File) ON (f.language)",
    "CREATE INDEX file_hash IF NOT EXISTS FOR (f:File) ON (f.hash)",
    "CREATE INDEX function_name IF NOT EXISTS FOR (fn:Function) ON (fn.name)",
    "CREATE INDEX class_name IF NOT EXISTS FOR (c:Class) ON (c.name)",
    "CREATE INDEX method_name IF NOT EXISTS FOR (m:Method) ON (m.name)",
)

# Relationship-scoped indexes. Useful for heavy traversals like call-graph
# search and git-coupling queries.
RELATIONSHIP_INDEXES: tuple[str, ...] = (
    "CREATE INDEX rel_calls_name IF NOT EXISTS FOR ()-[r:CALLS]-() ON (r.callee_name)",
    "CREATE INDEX rel_git_coupled_strength IF NOT EXISTS "
    "FOR ()-[r:GIT_COUPLED]-() ON (r.strength)",
)

SCHEMA_STATEMENTS: tuple[str, ...] = CONSTRAINTS + INDEXES + RELATIONSHIP_INDEXES


def apply_schema(session: object, statements: Iterable[str] | None = None) -> list[str]:
    """Run every schema statement against ``session``.

    ``session`` only needs a ``run(query)`` method — matching ``neo4j.Session``.
    We return the list of executed statements so callers can log/assert them.
    """

    run = getattr(session, "run", None)
    if not callable(run):
        raise TypeError("apply_schema() requires a neo4j-compatible session")

    stmts = tuple(statements) if statements is not None else SCHEMA_STATEMENTS
    executed: list[str] = []
    for stmt in stmts:
        run(stmt)
        executed.append(stmt)
    return executed
