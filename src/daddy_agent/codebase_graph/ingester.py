"""Neo4j ingestion for :class:`ParsedFile` values.

All Cypher is parameterised — never string-format values. We also keep each
statement small and scoped so that a partial failure only wastes a single file
transaction rather than corrupting the whole graph.

Batching rule: we flush after ~100 nodes per transaction.  Callers typically
use :func:`ingest_many` which handles batching automatically.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import asdict
from typing import Any

from daddy_agent.codebase_graph.parser import ParsedFile, ParsedFunction

log = logging.getLogger(__name__)

#: Rough upper bound on MERGEs per transaction before we commit.
BATCH_NODE_LIMIT = 100

# ---------------------------------------------------------------------------
# Cypher fragments
# ---------------------------------------------------------------------------

MERGE_FILE = """
MERGE (f:File {path: $path})
SET f.language = $language,
    f.hash = $hash,
    f.last_modified = timestamp()
"""

DELETE_FILE_CHILDREN = """
MATCH (f:File {path: $path})
OPTIONAL MATCH (f)-[:HAS_FUNCTION]->(fn:Function)
OPTIONAL MATCH (f)-[:HAS_CLASS]->(c:Class)
OPTIONAL MATCH (c)-[:HAS_METHOD]->(m:Method)
DETACH DELETE fn, c, m
"""

# Detach :IMPORTS edges from this file before re-ingestion.  Without this,
# removing an import line would leave a stale edge to the old module — the
# graph would say the file still depends on something it no longer uses.
DELETE_FILE_IMPORTS = """
MATCH (f:File {path: $path})-[r:IMPORTS]->()
DELETE r
"""

MERGE_FUNCTION = """
MATCH (f:File {path: $path})
MERGE (fn:Function {qualified_name: $qualified_name})
SET fn.name = $name,
    fn.signature = $signature,
    fn.docstring = $docstring,
    fn.start_line = $start_line,
    fn.end_line = $end_line,
    fn.file_path = $path
MERGE (f)-[:HAS_FUNCTION]->(fn)
"""

MERGE_CLASS = """
MATCH (f:File {path: $path})
MERGE (c:Class {qualified_name: $qualified_name})
SET c.name = $name,
    c.docstring = $docstring,
    c.file_path = $path,
    c.start_line = $start_line,
    c.end_line = $end_line
MERGE (f)-[:HAS_CLASS]->(c)
"""

MERGE_METHOD = """
MATCH (c:Class {qualified_name: $class_qname})
MERGE (m:Method {qualified_name: $qualified_name})
SET m.name = $name,
    m.signature = $signature,
    m.docstring = $docstring,
    m.class_name = $class_name,
    m.file_path = $path,
    m.start_line = $start_line,
    m.end_line = $end_line
MERGE (c)-[:HAS_METHOD]->(m)
"""

MERGE_IMPORT = """
MERGE (m:Module {name: $module})
WITH m
MATCH (f:File {path: $path})
MERGE (f)-[r:IMPORTS]->(m)
SET r.alias = $alias
"""

MERGE_EXTENDS = """
MATCH (child:Class {qualified_name: $child_qname})
MERGE (parent:Class {qualified_name: $parent_qname})
  ON CREATE SET parent.name = $parent_name, parent.file_path = ''
MERGE (child)-[:EXTENDS]->(parent)
"""

MERGE_IMPLEMENTS = """
MATCH (child:Class {qualified_name: $child_qname})
MERGE (iface:Class {qualified_name: $parent_qname})
  ON CREATE SET iface.name = $parent_name, iface.file_path = ''
MERGE (child)-[:IMPLEMENTS]->(iface)
"""

# Caller is always a Function or Method; we label the MATCH explicitly so an
# accidentally-identical ``qualified_name`` on another label (Variable,
# Module, …) can never be mistaken for our caller.  A label-less MATCH here
# previously allowed the query to traverse unrelated nodes and silently drop
# CALLS edges when a collision occurred.
MERGE_CALL = """
MATCH (caller:Function|Method {qualified_name: $caller_qname})
MERGE (callee:Function {qualified_name: $callee_qname})
  ON CREATE SET callee.name = $callee_name,
                callee.signature = '',
                callee.docstring = null,
                callee.start_line = 0,
                callee.end_line = 0,
                callee.file_path = ''
MERGE (caller)-[r:CALLS]->(callee)
SET r.callee_name = $callee_name
"""

# After an ingest pass we collapse ``external::<name>`` call targets into
# the local definition if one exists.  Runs once per repository index,
# fixing call-graph fragmentation caused by first-seen external names.
REWRITE_EXTERNAL_CALLS = """
MATCH (ext:Function {qualified_name: $external_qname})
WITH ext, ext.name AS nm
MATCH (local:Function {name: nm})
WHERE local.qualified_name <> $external_qname
  AND local.qualified_name STARTS WITH $path_prefix
WITH ext, local
MATCH (caller)-[r:CALLS]->(ext)
MERGE (caller)-[:CALLS]->(local)
DELETE r
WITH ext
WHERE NOT (ext)<-[:CALLS]-()
DELETE ext
"""

# ---------------------------------------------------------------------------
# Qualified name helpers
# ---------------------------------------------------------------------------


def _file_qname(path: str, name: str) -> str:
    return f"{path}::{name}"


def _class_qname(path: str, class_name: str) -> str:
    return f"{path}::class::{class_name}"


def _method_qname(path: str, class_name: str, method_name: str) -> str:
    return f"{path}::class::{class_name}::{method_name}"


def _external_qname(name: str) -> str:
    """For callees we don't resolve: store under ``external::<name>``."""

    return f"external::{name}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def ingest_file(session: Any, parsed: ParsedFile) -> int:
    """Ingest a single :class:`ParsedFile`.

    Returns the number of Cypher statements executed (useful for tests).
    """

    run = getattr(session, "run", None)
    if not callable(run):
        raise TypeError("ingest_file() requires a neo4j-compatible session")

    count = 0
    # File node (and wipe previous structural children + import edges so
    # re-ingestion is idempotent — call/import edges get re-created below).
    run(MERGE_FILE, path=parsed.path, language=parsed.language, hash=parsed.hash)
    count += 1
    run(DELETE_FILE_CHILDREN, path=parsed.path)
    count += 1
    run(DELETE_FILE_IMPORTS, path=parsed.path)
    count += 1

    # Imports
    for imp in parsed.imports:
        run(MERGE_IMPORT, path=parsed.path, module=imp.module, alias=imp.alias)
        count += 1

    # Top-level functions
    for fn in parsed.functions:
        qname = _file_qname(parsed.path, fn.name)
        run(MERGE_FUNCTION, path=parsed.path, qualified_name=qname, **_fn_params(fn))
        count += 1
        count += _emit_calls(run, parsed.path, caller_qname=qname, calls=fn.calls)

    # Classes + methods
    for cls in parsed.classes:
        class_qname = _class_qname(parsed.path, cls.name)
        run(
            MERGE_CLASS,
            path=parsed.path,
            qualified_name=class_qname,
            name=cls.name,
            docstring=cls.docstring,
            start_line=cls.start_line,
            end_line=cls.end_line,
        )
        count += 1
        for parent in cls.extends:
            run(
                MERGE_EXTENDS,
                child_qname=class_qname,
                parent_qname=_external_qname(parent),
                parent_name=parent,
            )
            count += 1
        for iface in cls.implements:
            run(
                MERGE_IMPLEMENTS,
                child_qname=class_qname,
                parent_qname=_external_qname(iface),
                parent_name=iface,
            )
            count += 1
        for method in cls.methods:
            method_qname = _method_qname(parsed.path, cls.name, method.name)
            run(
                MERGE_METHOD,
                path=parsed.path,
                class_qname=class_qname,
                qualified_name=method_qname,
                name=method.name,
                signature=method.signature,
                docstring=method.docstring,
                class_name=cls.name,
                start_line=method.start_line,
                end_line=method.end_line,
            )
            count += 1
            count += _emit_calls(run, parsed.path, caller_qname=method_qname, calls=method.calls)

    return count


def ingest_many(session: Any, parsed_iter: Iterable[ParsedFile]) -> int:
    """Batch-ingest files. Returns total Cypher statements executed.

    We approximate "batching" by committing whenever we've run ``BATCH_NODE_LIMIT``
    statements; the neo4j Python driver auto-commits per ``session.run`` when
    used outside an explicit transaction, so for the real driver this function
    delegates to a ``write_transaction`` when available.
    """

    total = 0
    batch: list[ParsedFile] = []
    batch_stmts = 0

    def flush() -> int:
        nonlocal batch, batch_stmts
        if not batch:
            return 0
        written = _flush_batch(session, batch)
        batch = []
        batch_stmts = 0
        return written

    for parsed in parsed_iter:
        batch.append(parsed)
        # Rough cost estimate: 1 file + len(imports) + len(functions) * (1 + calls) + classes
        cost = 1 + len(parsed.imports) + sum(1 + len(fn.calls) for fn in parsed.functions)
        for cls in parsed.classes:
            cost += 1 + len(cls.extends) + len(cls.implements)
            cost += sum(1 + len(m.calls) for m in cls.methods)
        batch_stmts += cost
        if batch_stmts >= BATCH_NODE_LIMIT:
            total += flush()
    total += flush()
    return total


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _fn_params(fn: ParsedFunction) -> dict[str, Any]:
    data = asdict(fn)
    data.pop("calls", None)
    return data


def _emit_calls(run: Any, path: str, *, caller_qname: str, calls: Iterable[str]) -> int:
    count = 0
    for callee in calls:
        if not callee:
            continue
        run(
            MERGE_CALL,
            caller_qname=caller_qname,
            callee_qname=_external_qname(callee),
            callee_name=callee,
        )
        count += 1
    return count


def _flush_batch(session: Any, batch: list[ParsedFile]) -> int:
    """Flush a batch of parsed files in a single write transaction if possible."""

    executed = 0
    write_tx = getattr(session, "execute_write", None) or getattr(
        session, "write_transaction", None
    )
    if callable(write_tx):
        # Real neo4j driver path — execute atomically.
        def _work(tx: Any) -> int:
            inner = 0
            for parsed in batch:
                inner += ingest_file(tx, parsed)
            return inner

        try:
            executed = write_tx(_work)
            return executed
        except Exception as exc:  # pragma: no cover - depends on driver
            log.warning("batched write failed, falling back to per-file: %s", exc)

    # Fallback: just run per-file against the session.
    for parsed in batch:
        executed += ingest_file(session, parsed)
    return executed
