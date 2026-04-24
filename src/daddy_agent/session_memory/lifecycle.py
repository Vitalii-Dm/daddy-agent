"""Agent session lifecycle helpers.

Each TMUX agent follows the lifecycle described in
``PLAN-neo4j-knowledge-graphs.md`` section "Agent Integration Pattern":

1. :func:`start_session` — create a ``Session`` keyed on tmux pane id and
   hydrate the agent with existing context.
2. :func:`log_message`, :func:`log_reasoning` — append to short-term and
   reasoning memory. Writes run on a daemon thread (non-blocking);
   :func:`end_session` and :func:`flush` drain in-flight writes before
   shutdown so messages scheduled in the final milliseconds are not
   silently dropped at interpreter exit.
3. :func:`pull_context` — assemble combined context for a new task.
4. :func:`cross_agent_query` — read what other agents have learned.
5. :func:`end_session` — close the session and persist a summary.

The real backend is :mod:`neo4j_agent_memory`; callers depend only on the
:class:`MemoryBackend` protocol so tests can inject :class:`FakeMemoryBackend`.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

log = logging.getLogger(__name__)

__all__ = [
    "ContextBundle",
    "FakeMemoryBackend",
    "MemoryBackend",
    "SessionHandle",
    "ToolCallLog",
    "cross_agent_query",
    "end_session",
    "flush",
    "log_message",
    "log_reasoning",
    "pull_context",
    "start_session",
]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class SessionHandle:
    """Handle returned by :func:`start_session`.

    ``session_id`` is a stable UUID; ``pane_id`` is the tmux pane the agent is
    running in. Callers pass the handle into every other lifecycle helper.
    """

    session_id: str
    agent_id: str
    pane_id: str
    task: str
    started_at: datetime
    backend: MemoryBackend
    closed: bool = False


@dataclass
class ToolCallLog:
    """A single tool call to record as part of a reasoning trace."""

    name: str
    input: Any
    output: Any
    duration_ms: float
    success: bool = True


@dataclass
class ContextBundle:
    """Combined context returned by :func:`pull_context`.

    ``messages`` come from short-term memory; ``entities`` from long-term
    memory; ``reasoning`` from past reasoning traces on similar tasks.
    """

    task: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    entities: list[dict[str, Any]] = field(default_factory=list)
    reasoning: list[dict[str, Any]] = field(default_factory=list)

    def total(self) -> int:
        return len(self.messages) + len(self.entities) + len(self.reasoning)


# ---------------------------------------------------------------------------
# Backend protocol + in-memory fake
# ---------------------------------------------------------------------------


@runtime_checkable
class MemoryBackend(Protocol):
    """The subset of ``AgentMemoryClient`` methods we depend on.

    Keeping this tight makes it trivial to stub out in tests and lets us swap
    the underlying library without changing callers.
    """

    def start_session(
        self, *, session_id: str, agent_id: str, pane_id: str, task: str
    ) -> None: ...

    def end_session(self, *, session_id: str, summary: str) -> None: ...

    def add_message(
        self, *, session_id: str, role: str, content: str, timestamp: datetime
    ) -> None: ...

    def add_reasoning_trace(
        self,
        *,
        session_id: str,
        goal: str,
        outcome: str,
        tool_calls: list[dict[str, Any]],
        timestamp: datetime,
    ) -> None: ...

    def get_context(
        self, *, task: str, top_k: int
    ) -> dict[str, list[dict[str, Any]]]: ...

    def search_memory(
        self, *, query: str, agent_id: str | None, since: datetime | None
    ) -> list[dict[str, Any]]: ...


class FakeMemoryBackend:
    """A deterministic in-memory backend used for unit tests.

    Every method records its arguments in public lists so tests can assert on
    the exact call sequence. No network, no threads — the fake is safe to use
    in offline CI.

    Also implements :class:`daddy_agent.session_memory.facts.FactStore` so
    the same backend object serves both lifecycle + temporal-fact calls,
    mirroring the real ``AgentMemoryClient`` which does the same.
    """

    def __init__(self) -> None:
        self.sessions: list[dict[str, Any]] = []
        self.ended_sessions: list[dict[str, Any]] = []
        self.messages: list[dict[str, Any]] = []
        self.reasoning: list[dict[str, Any]] = []
        self.context_queries: list[dict[str, Any]] = []
        self.search_queries: list[dict[str, Any]] = []

        # seed data: search returns whatever is in ``seeded_search_hits``
        # filtered by ``agent_id``/``since``.
        self.seeded_search_hits: list[dict[str, Any]] = []
        self.seeded_context: dict[str, list[dict[str, Any]]] = {
            "messages": [],
            "entities": [],
            "reasoning": [],
        }

        # Composed FactStore — fresh per backend, shared state with the
        # rest of this object so tests can assert on fact history alongside
        # message/reasoning history.
        from daddy_agent.session_memory.facts import InMemoryFactStore
        self._fact_store = InMemoryFactStore()

    # -- FactStore protocol -----------------------------------------------
    # Delegate to the composed store so the fake satisfies FactStore.

    def write_fact(self, fact: Any) -> None:
        self._fact_store.write_fact(fact)

    def set_valid_until(self, fact_id: str, valid_until: datetime) -> Any:
        return self._fact_store.set_valid_until(fact_id, valid_until)

    def list_facts(self, subject: str, predicate: str) -> list[Any]:
        return self._fact_store.list_facts(subject, predicate)

    # -- lifecycle ---------------------------------------------------------

    def start_session(
        self, *, session_id: str, agent_id: str, pane_id: str, task: str
    ) -> None:
        self.sessions.append(
            {
                "session_id": session_id,
                "agent_id": agent_id,
                "pane_id": pane_id,
                "task": task,
            }
        )

    def end_session(self, *, session_id: str, summary: str) -> None:
        self.ended_sessions.append({"session_id": session_id, "summary": summary})

    # -- writes ------------------------------------------------------------

    def add_message(
        self, *, session_id: str, role: str, content: str, timestamp: datetime
    ) -> None:
        self.messages.append(
            {
                "session_id": session_id,
                "role": role,
                "content": content,
                "timestamp": timestamp,
            }
        )

    def add_reasoning_trace(
        self,
        *,
        session_id: str,
        goal: str,
        outcome: str,
        tool_calls: list[dict[str, Any]],
        timestamp: datetime,
    ) -> None:
        self.reasoning.append(
            {
                "session_id": session_id,
                "goal": goal,
                "outcome": outcome,
                "tool_calls": tool_calls,
                "timestamp": timestamp,
            }
        )

    # -- reads -------------------------------------------------------------

    def get_context(
        self, *, task: str, top_k: int
    ) -> dict[str, list[dict[str, Any]]]:
        self.context_queries.append({"task": task, "top_k": top_k})
        # Respect top_k by slicing each bucket.
        return {
            "messages": list(self.seeded_context.get("messages", []))[:top_k],
            "entities": list(self.seeded_context.get("entities", []))[:top_k],
            "reasoning": list(self.seeded_context.get("reasoning", []))[:top_k],
        }

    def search_memory(
        self,
        *,
        query: str,
        agent_id: str | None,
        since: datetime | None,
    ) -> list[dict[str, Any]]:
        self.search_queries.append(
            {"query": query, "agent_id": agent_id, "since": since}
        )
        hits = list(self.seeded_search_hits)
        if agent_id is not None:
            # The real MCP query returns entries from other agents; we honour
            # that semantic here by filtering OUT the caller's own agent_id.
            hits = [h for h in hits if h.get("agent_id") != agent_id]
        if since is not None:
            hits = [h for h in hits if h.get("timestamp", since) >= since]
        return hits


# ---------------------------------------------------------------------------
# Lifecycle helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(tz=UTC)


# Tracks every in-flight fire-and-forget write so end_session / flush can
# drain them before the process exits — daemon threads are killed abruptly
# at interpreter shutdown (CPython doc), silently dropping the last few
# writes otherwise.
_IN_FLIGHT_LOCK = threading.Lock()
_IN_FLIGHT: set[threading.Thread] = set()


def _fire_and_forget(target: Any, /, **kwargs: Any) -> None:
    """Run ``target(**kwargs)`` on a daemon thread.

    We deliberately do **not** block the caller — writes are async per the
    plan's "Message storage latency under 100ms" budget.  However we DO
    keep the thread registered and log exceptions, so that:

      * :func:`flush` can join pending writes before shutdown or session end;
      * failures are never silent — the stdlib ``logging`` module records
        them with a full traceback via ``logger.exception``.
    """

    def _run() -> None:
        try:
            target(**kwargs)
        except Exception:
            log.exception("async memory write failed: %s", target)
        finally:
            with _IN_FLIGHT_LOCK:
                _IN_FLIGHT.discard(threading.current_thread())

    t = threading.Thread(target=_run, daemon=True)
    with _IN_FLIGHT_LOCK:
        _IN_FLIGHT.add(t)
    t.start()


def flush(timeout: float = 2.0) -> int:
    """Wait up to ``timeout`` seconds for pending async writes to complete.

    Returns the number of writes that did NOT finish within the budget — 0
    means everything drained cleanly.  Callers that care about durability
    (session end, process shutdown) should invoke this explicitly.
    """

    deadline = time.monotonic() + timeout
    with _IN_FLIGHT_LOCK:
        threads = list(_IN_FLIGHT)
    for t in threads:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        t.join(timeout=remaining)
    with _IN_FLIGHT_LOCK:
        return sum(1 for t in _IN_FLIGHT if t.is_alive())


def start_session(
    agent_id: str,
    pane_id: str,
    task: str,
    *,
    backend: MemoryBackend,
) -> SessionHandle:
    """Open a new session and register it with the backend.

    The session id is a UUID (not the pane id) so that a single pane can host
    multiple sequential sessions without collisions. ``pane_id`` is stored as
    a property for cross-referencing with the tmux manager.
    """

    handle = SessionHandle(
        session_id=str(uuid.uuid4()),
        agent_id=agent_id,
        pane_id=pane_id,
        task=task,
        started_at=_now(),
        backend=backend,
    )
    backend.start_session(
        session_id=handle.session_id,
        agent_id=agent_id,
        pane_id=pane_id,
        task=task,
    )
    return handle


def end_session(handle: SessionHandle, summary: str | None = None) -> None:
    """Close ``handle`` and persist a summary.

    If ``summary`` is ``None`` an auto-summary is synthesised from the task.
    The real backend is expected to run a proper LLM summariser server-side;
    this fallback guarantees the session always ends with non-empty text.
    """

    if handle.closed:
        return
    # Drain any in-flight log_message / log_reasoning calls before the
    # backend records the session as closed.  Without this, fire-and-forget
    # writes scheduled in the final milliseconds of the session can be
    # lost when the process exits.
    flush(timeout=2.0)
    resolved = summary if summary is not None else f"Session for task: {handle.task}"
    handle.backend.end_session(session_id=handle.session_id, summary=resolved)
    handle.closed = True


def log_message(handle: SessionHandle, role: str, content: str) -> None:
    """Append a message to short-term memory. Non-blocking."""

    if handle.closed:
        raise RuntimeError("cannot log message on a closed session")
    _fire_and_forget(
        handle.backend.add_message,
        session_id=handle.session_id,
        role=role,
        content=content,
        timestamp=_now(),
    )


def log_reasoning(
    handle: SessionHandle,
    goal: str,
    outcome: str,
    tool_calls: list[ToolCallLog],
) -> None:
    """Append a reasoning trace. Non-blocking."""

    if handle.closed:
        raise RuntimeError("cannot log reasoning on a closed session")
    payload = [
        {
            "name": c.name,
            "input": c.input,
            "output": c.output,
            "duration_ms": c.duration_ms,
            "success": c.success,
        }
        for c in tool_calls
    ]
    _fire_and_forget(
        handle.backend.add_reasoning_trace,
        session_id=handle.session_id,
        goal=goal,
        outcome=outcome,
        tool_calls=payload,
        timestamp=_now(),
    )


def pull_context(
    task: str,
    *,
    top_k: int = 20,
    backend: MemoryBackend,
) -> ContextBundle:
    """Return combined short-term + long-term + reasoning context for ``task``."""

    if top_k < 0:
        raise ValueError("top_k must be non-negative")
    raw = backend.get_context(task=task, top_k=top_k)
    return ContextBundle(
        task=task,
        messages=list(raw.get("messages", []))[:top_k],
        entities=list(raw.get("entities", []))[:top_k],
        reasoning=list(raw.get("reasoning", []))[:top_k],
    )


def cross_agent_query(
    question: str,
    *,
    agent_id: str,
    since: datetime | None = None,
    backend: MemoryBackend,
) -> list[dict[str, Any]]:
    """Ask what *other* agents have learned about ``question``.

    ``agent_id`` is the caller — results are filtered to exclude the caller's
    own entries so workers actually get cross-pollination. ``since`` limits
    to entries created after the given timestamp.
    """

    return backend.search_memory(query=question, agent_id=agent_id, since=since)
