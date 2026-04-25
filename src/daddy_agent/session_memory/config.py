"""Configuration for ``neo4j-agent-memory``.

Reads the environment variables documented in the project plan and exposes
:func:`build_client` which returns a configured ``AgentMemoryClient``.

Environment variables
---------------------

``NAM_NEO4J__URI``
    Bolt URI. Defaults to ``bolt://localhost:7687``.
``NAM_NEO4J__USER``
    Neo4j user. Defaults to ``neo4j``.
``NAM_NEO4J__PASSWORD``
    Neo4j password. No default — must be set.
``NAM_NEO4J__DATABASE``
    Database name. Defaults to ``agent_memory``.
``OPENAI_API_KEY``
    Used by ``neo4j-agent-memory`` for embeddings / LLM fallback. Optional
    when embeddings are disabled, but required for the default pipeline.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

__all__ = ["MemoryConfig", "MissingMemoryLibraryError", "build_client", "load_config"]


_INSTALL_HINT = (
    "neo4j-agent-memory is not installed. Install it with one of:\n"
    "  uv pip install 'neo4j-agent-memory[mcp]'\n"
    "  pip install 'neo4j-agent-memory[mcp]'\n"
    "See https://github.com/neo4j-labs/agent-memory for details."
)


class MissingMemoryLibraryError(ImportError):
    """Raised when the ``neo4j-agent-memory`` library cannot be imported."""


@dataclass(frozen=True)
class MemoryConfig:
    """Resolved configuration for the agent-memory backend."""

    uri: str
    user: str
    password: str
    database: str
    openai_api_key: str | None

    def as_kwargs(self) -> dict[str, Any]:
        """Return kwargs suitable for the underlying client constructor."""

        return {
            "uri": self.uri,
            "user": self.user,
            "password": self.password,
            "database": self.database,
            "openai_api_key": self.openai_api_key,
        }


def load_config(env: dict[str, str] | None = None) -> MemoryConfig:
    """Resolve a :class:`MemoryConfig` from the environment.

    Parameters
    ----------
    env:
        Optional mapping to read from. Defaults to :data:`os.environ`. Useful
        for tests.
    """

    source = env if env is not None else os.environ
    password = source.get("NAM_NEO4J__PASSWORD", "")
    if not password:
        # Keep the empty string rather than raising here so that tests and
        # offline tooling can still import and inspect the config. The real
        # client constructor will raise when it fails to authenticate.
        password = ""
    return MemoryConfig(
        uri=source.get("NAM_NEO4J__URI", "bolt://localhost:7687"),
        user=source.get("NAM_NEO4J__USER", "neo4j"),
        password=password,
        database=source.get("NAM_NEO4J__DATABASE", "agent_memory"),
        openai_api_key=source.get("OPENAI_API_KEY") or None,
    )


def build_client(config: MemoryConfig | None = None) -> Any:
    """Construct the real ``AgentMemoryClient`` with our defaults.

    Raises
    ------
    MissingMemoryLibraryError
        If ``neo4j-agent-memory`` is not installed. The error message contains
        install instructions.
    """

    try:  # pragma: no cover - exercised indirectly
        from neo4j_agent_memory import AgentMemoryClient  # type: ignore
    except ImportError as exc:  # pragma: no cover - import guard
        raise MissingMemoryLibraryError(_INSTALL_HINT) from exc

    cfg = config or load_config()
    return AgentMemoryClient(**cfg.as_kwargs())
