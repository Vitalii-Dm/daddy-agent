"""Codebase MCP server for the Neo4j knowledge-graph system.

This package exposes MCP tools (search, callers, callees, deps, impact, dead
code, community, raw read-only Cypher) over the Neo4j codebase database.

Worker 3 scope: the server, its Cypher library and a read-only validator.
The ingestion pipeline (Worker 2) is kept deliberately out-of-tree; nothing
in this module imports from it.
"""

from daddy_agent.codebase_mcp.safety import (
    ReadOnlyViolation,
    validate_read_only_cypher,
)

__all__ = ["ReadOnlyViolation", "validate_read_only_cypher"]
