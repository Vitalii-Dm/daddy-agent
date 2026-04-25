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

# Multi-project scoping. Every code-graph node carries ``project_root`` —
# the absolute filesystem path of the repo it was indexed from — so several
# repos can share a Neo4j Community-Edition instance without identifier
# collisions. ``File`` uniqueness is the composite (path, project_root); the
# qualified_name keys for Function/Class/Method already embed the path, so
# we extend them with project_root via composite constraints too.
CONSTRAINTS: tuple[str, ...] = (
    "CREATE CONSTRAINT file_path_project IF NOT EXISTS "
    "FOR (f:File) REQUIRE (f.path, f.project_root) IS UNIQUE",
    "CREATE CONSTRAINT function_qname_project IF NOT EXISTS "
    "FOR (fn:Function) REQUIRE (fn.qualified_name, fn.project_root) IS UNIQUE",
    "CREATE CONSTRAINT class_qname_project IF NOT EXISTS "
    "FOR (c:Class) REQUIRE (c.qualified_name, c.project_root) IS UNIQUE",
    "CREATE CONSTRAINT method_qname_project IF NOT EXISTS "
    "FOR (m:Method) REQUIRE (m.qualified_name, m.project_root) IS UNIQUE",
    # Modules are package-scoped concepts (typing, os, ...). Naming collides
    # *intentionally* across projects — keep them globally unique by name so
    # cross-project module nodes can be deduplicated and shared.
    "CREATE CONSTRAINT module_name IF NOT EXISTS "
    "FOR (m:Module) REQUIRE m.name IS UNIQUE",
    "CREATE CONSTRAINT variable_qname_project IF NOT EXISTS "
    "FOR (v:Variable) REQUIRE (v.qualified_name, v.project_root) IS UNIQUE",
    "CREATE CONSTRAINT community_id IF NOT EXISTS "
    "FOR (c:Community) REQUIRE c.id IS UNIQUE",
)

# ---------------------------------------------------------------------------
# Indexes
# ---------------------------------------------------------------------------

INDEXES: tuple[str, ...] = (
    "CREATE INDEX file_language IF NOT EXISTS FOR (f:File) ON (f.language)",
    "CREATE INDEX file_hash IF NOT EXISTS FOR (f:File) ON (f.hash)",
    "CREATE INDEX file_project_root IF NOT EXISTS FOR (f:File) ON (f.project_root)",
    "CREATE INDEX function_name IF NOT EXISTS FOR (fn:Function) ON (fn.name)",
    "CREATE INDEX function_project_root IF NOT EXISTS FOR (fn:Function) ON (fn.project_root)",
    "CREATE INDEX class_name IF NOT EXISTS FOR (c:Class) ON (c.name)",
    "CREATE INDEX class_project_root IF NOT EXISTS FOR (c:Class) ON (c.project_root)",
    "CREATE INDEX method_name IF NOT EXISTS FOR (m:Method) ON (m.name)",
    "CREATE INDEX method_project_root IF NOT EXISTS FOR (m:Method) ON (m.project_root)",
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
