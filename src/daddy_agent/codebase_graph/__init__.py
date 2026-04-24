"""Codebase knowledge graph ingestion pipeline.

This package parses a repository with Tree-sitter, converts the result into
Neo4j ``MERGE`` writes, and keeps the graph fresh via hash-based incremental
indexing plus git hooks.

The public surface is intentionally small; most callers only need:

* :func:`parser.parse_file` — parse a single file into dataclasses.
* :func:`ingester.ingest_file` / :func:`ingester.ingest_many` — push parsed
  files into Neo4j.
* :func:`indexer.index_repository` — walk a repo, honour ``.gitignore`` and
  only re-parse files whose sha256 changed.
* :func:`schema.apply_schema` — create constraints/indexes idempotently.
* :func:`git_coupling.compute_coupling` — derive ``GIT_COUPLED`` edges from
  ``git log``.
* :func:`git_hooks.install_hook` — install a ``post-commit`` hook that
  incrementally re-indexes after each commit.
"""

from daddy_agent.codebase_graph.parser import (
    ParsedClass,
    ParsedFile,
    ParsedFunction,
    ParsedImport,
    parse_file,
    parse_source,
)
from daddy_agent.codebase_graph.schema import SCHEMA_STATEMENTS, apply_schema

__all__ = [
    "ParsedClass",
    "ParsedFile",
    "ParsedFunction",
    "ParsedImport",
    "SCHEMA_STATEMENTS",
    "apply_schema",
    "parse_file",
    "parse_source",
]
