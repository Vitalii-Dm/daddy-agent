"""Cypher query library for the codebase MCP server.

Every query is a parameterised string constant.  Keeping them in one
module means a graph schema change (Worker 2 territory) only needs a
single-file update here.

All queries target the database named by ``NEO4J_CODEBASE_DB`` (handled
by the driver session, not the query itself).
"""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# search_code
# --------------------------------------------------------------------------- #

SEARCH_CODE: str = """
// Full-text-ish search over File / Function / Class / Method nodes.
// We match on name, path and docstring using case-insensitive CONTAINS
// so the query works without the optional full-text index.
MATCH (n)
WHERE (n:File OR n:Function OR n:Class OR n:Method)
  AND (
    toLower(coalesce(n.name, ''))      CONTAINS toLower($query)
    OR toLower(coalesce(n.path, ''))   CONTAINS toLower($query)
    OR toLower(coalesce(n.docstring, '')) CONTAINS toLower($query)
  )
RETURN
  labels(n)[0]                        AS kind,
  coalesce(n.name, n.path)            AS name,
  coalesce(n.file_path, n.path)       AS path,
  coalesce(n.start_line, 0)           AS line,
  coalesce(n.docstring, '')           AS docstring
ORDER BY kind, name
LIMIT $limit
""".strip()


# --------------------------------------------------------------------------- #
# get_callers / get_callees
# --------------------------------------------------------------------------- #

GET_CALLERS: str = """
// Functions that CALL the named function.
MATCH (target:Function {name: $name})
WHERE $file_path IS NULL OR target.file_path = $file_path
MATCH (caller:Function)-[:CALLS]->(target)
RETURN DISTINCT
  caller.name                                AS name,
  caller.file_path                           AS file_path,
  coalesce(caller.start_line, 0)             AS line,
  coalesce(caller.signature, '')             AS signature
ORDER BY file_path, name
""".strip()


GET_CALLEES: str = """
// Functions called by the named function.
MATCH (source:Function {name: $name})
WHERE $file_path IS NULL OR source.file_path = $file_path
MATCH (source)-[:CALLS]->(callee:Function)
RETURN DISTINCT
  callee.name                                AS name,
  callee.file_path                           AS file_path,
  coalesce(callee.start_line, 0)             AS line,
  coalesce(callee.signature, '')             AS signature
ORDER BY file_path, name
""".strip()


# --------------------------------------------------------------------------- #
# get_dependencies
# --------------------------------------------------------------------------- #

GET_DEPENDENCIES: str = """
// IMPORTS chain up to $depth hops starting from a given File.
// Variable-length path with an upper bound avoids runaways on huge graphs.
MATCH (start:File {path: $file_path})
CALL {
  WITH start
  MATCH path = (start)-[:IMPORTS*1..%(depth)d]->(dep)
  RETURN dep, length(path) AS hops
}
RETURN DISTINCT
  labels(dep)[0]                             AS kind,
  coalesce(dep.path, dep.name)               AS name,
  hops                                       AS depth
ORDER BY depth, name
""".strip()


# --------------------------------------------------------------------------- #
# get_community
# --------------------------------------------------------------------------- #

GET_COMMUNITY: str = """
// Community label for a node (File / Function / Class).  Falls back to
// null if community detection has not been run yet.
MATCH (n)
WHERE (n:File OR n:Function OR n:Class OR n:Method)
  AND (n.name = $name OR n.path = $name)
OPTIONAL MATCH (n)-[:BELONGS_TO]->(c:Community)
RETURN
  labels(n)[0]                               AS kind,
  coalesce(n.name, n.path)                   AS name,
  c.id                                       AS community_id,
  c.label                                    AS community_label,
  c.description                              AS community_description
LIMIT 1
""".strip()


# --------------------------------------------------------------------------- #
# impact_analysis
# --------------------------------------------------------------------------- #

IMPACT_ANALYSIS: str = """
// BFS upstream over callers (functions defined in the file) and over
// files that import the file.  Capped at $node_cap nodes.
MATCH (f:File {path: $file_path})
OPTIONAL MATCH (f)<-[:IMPORTS*1..5]-(importer:File)
WITH f, collect(DISTINCT importer) AS importers
OPTIONAL MATCH (fn:Function {file_path: $file_path})<-[:CALLS*1..5]-(caller:Function)
WITH f, importers, collect(DISTINCT caller) AS callers
WITH
  [x IN importers | {kind: 'File',     name: x.path, file_path: x.path}] +
  [x IN callers   | {kind: 'Function', name: x.name, file_path: x.file_path}]
  AS rows
UNWIND rows AS row
RETURN row.kind AS kind, row.name AS name, row.file_path AS file_path
LIMIT $node_cap
""".strip()


# --------------------------------------------------------------------------- #
# find_dead_code
# --------------------------------------------------------------------------- #

FIND_DEAD_CODE: str = """
// Heuristic: Function nodes with no incoming CALLS edges and not flagged
// as exported.  The ``exported`` property is set by the ingestion
// pipeline (Worker 2); absent values are treated as False.
MATCH (fn:Function)
WHERE NOT ( ()-[:CALLS]->(fn) )
  AND coalesce(fn.exported, false) = false
RETURN
  fn.name                                    AS name,
  fn.file_path                               AS file_path,
  coalesce(fn.start_line, 0)                 AS line,
  coalesce(fn.signature, '')                 AS signature
ORDER BY file_path, name
LIMIT $limit
""".strip()


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def render_dependencies_query(depth: int) -> str:
    """Inline ``depth`` into :data:`GET_DEPENDENCIES`.

    ``depth`` participates in the variable-length path pattern and cannot
    be passed as a regular Cypher parameter, so we interpolate it after
    sanity-checking the integer bounds.  The caller is responsible for
    validating its input.
    """
    if not isinstance(depth, int) or depth < 1 or depth > 10:
        raise ValueError("depth must be an int in [1, 10]")
    return GET_DEPENDENCIES % {"depth": depth}


__all__ = [
    "FIND_DEAD_CODE",
    "GET_CALLEES",
    "GET_CALLERS",
    "GET_COMMUNITY",
    "GET_DEPENDENCIES",
    "IMPACT_ANALYSIS",
    "SEARCH_CODE",
    "render_dependencies_query",
]
