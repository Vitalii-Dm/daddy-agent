"""Visualization layer for the Neo4j knowledge graph system.

Provides:
  * A FastAPI server (``daddy_agent.viz.server``) that exposes a Sigma.js
    compatible JSON API for both the codebase and memory graphs.
  * A single-page web dashboard served from ``daddy_agent/viz/static``.
  * An Obsidian vault exporter (``daddy_agent.viz.obsidian_export``).

See ``docs/viz.md`` for usage.
"""

from daddy_agent.viz.server import create_app

__all__ = ["create_app"]
