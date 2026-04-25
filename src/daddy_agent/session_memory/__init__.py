"""Session Memory integration for daddy-agent.

This package wraps the ``neo4j-agent-memory`` library to provide:

* Agent session lifecycle helpers keyed on tmux pane id (:mod:`.lifecycle`).
* Temporal-validity fact helpers (:mod:`.facts`).
* Shared-markdown Kanban helper with file locking (:mod:`.kanban`).
* A :class:`MemoryBackend` protocol so the real ``neo4j-agent-memory`` client
  can be swapped for an in-memory fake during tests.

Public re-exports are kept minimal on purpose; prefer importing from the
submodule you actually need.
"""

from __future__ import annotations

from .config import MemoryConfig, build_client, load_config
from .facts import Fact, FactStore, invalidate_fact, query_fact_history, store_fact
from .lifecycle import (
    ContextBundle,
    FakeMemoryBackend,
    MemoryBackend,
    SessionHandle,
    ToolCallLog,
    cross_agent_query,
    end_session,
    flush,
    log_message,
    log_reasoning,
    pull_context,
    start_session,
)

__all__ = [
    "ContextBundle",
    "Fact",
    "FactStore",
    "FakeMemoryBackend",
    "MemoryBackend",
    "MemoryConfig",
    "SessionHandle",
    "ToolCallLog",
    "build_client",
    "cross_agent_query",
    "end_session",
    "flush",
    "invalidate_fact",
    "load_config",
    "log_message",
    "log_reasoning",
    "pull_context",
    "query_fact_history",
    "start_session",
    "store_fact",
]
