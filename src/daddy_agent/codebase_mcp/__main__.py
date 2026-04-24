"""``python -m daddy_agent.codebase_mcp`` entry point.

Reads ``NEO4J_URI``, ``NEO4J_USER``, ``NEO4J_PASSWORD`` and
``NEO4J_CODEBASE_DB`` from the environment, connects to Neo4j, and
serves the FastMCP codebase-graph tools over stdio.
"""

from __future__ import annotations

from daddy_agent.codebase_mcp.server import serve


def main() -> None:
    """Start the stdio MCP server."""
    serve()


if __name__ == "__main__":  # pragma: no cover - exercised via CLI only
    main()
