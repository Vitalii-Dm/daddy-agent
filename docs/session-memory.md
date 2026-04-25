# Session Memory — Agent Integration Guide

This document explains how a Python agent (Claude Code, Codex, custom worker)
hooks into the `neo4j-agent-memory` graph via the helpers in
`src/daddy_agent/session_memory/`.

## Lifecycle

```
  tmux pane spawns agent
          |
          v
  +---------------------+       pull_context(task)
  |   start_session     |  ------------------------------>  short-term +
  |   (agent_id,        |                                    long-term +
  |    pane_id, task)   |                                    reasoning
  +---------------------+
          |
          v  returns SessionHandle
  +---------------------+
  |   agent works       |
  |                     |   log_message(handle, role, text)   (async)
  |                     |   log_reasoning(handle, goal, ...)  (async)
  |                     |   store_fact(subject, pred, obj)
  |                     |   cross_agent_query("...")
  +---------------------+
          |
          v
  +---------------------+
  |   end_session       |  --- persists summary + bridges ---> long-term
  +---------------------+
```

## Minimal Python agent example

```python
from daddy_agent.session_memory import (
    SessionHandle,
    ToolCallLog,
    build_client,
    cross_agent_query,
    end_session,
    log_message,
    log_reasoning,
    pull_context,
    start_session,
)

backend = build_client()  # real neo4j-agent-memory client

def run_agent(agent_id: str, pane_id: str, task: str) -> None:
    handle: SessionHandle = start_session(
        agent_id=agent_id, pane_id=pane_id, task=task, backend=backend
    )
    try:
        ctx = pull_context(task, top_k=20, backend=backend)
        log_message(handle, "system", f"pulled {ctx.total()} context items")

        # ...do work, call tools...

        log_reasoning(
            handle,
            goal="pick database driver",
            outcome="use psycopg3 for async support",
            tool_calls=[
                ToolCallLog(
                    name="search_code",
                    input={"q": "database connection"},
                    output={"hits": 3},
                    duration_ms=42.0,
                ),
            ],
        )
    finally:
        end_session(handle, summary="implemented X, see reasoning trace")
```

## Cross-agent query

From the plan: *"what did Worker 1 decide about the database schema?"*

```python
from datetime import datetime, timedelta, timezone

hits = cross_agent_query(
    "database schema decisions",
    agent_id="worker-3",           # caller's own id — filtered OUT of results
    since=datetime.now(timezone.utc) - timedelta(days=7),
    backend=backend,
)
for hit in hits:
    print(hit["agent_id"], hit["content"])
```

The backend filters out the caller's own entries so workers actually inherit
knowledge from their peers instead of replaying their own notes.

## Temporal facts

```python
from daddy_agent.session_memory.facts import (
    invalidate_fact,
    query_fact_history,
    store_fact,
)

fact = store_fact("auth_module", "uses_algorithm", "RS256", store=fact_store)
# ... later, after a migration ...
invalidate_fact(fact.id, store=fact_store)
new_fact = store_fact("auth_module", "uses_algorithm", "EdDSA", store=fact_store)

history = query_fact_history("auth_module", "uses_algorithm", store=fact_store)
# -> [RS256 (valid_until set), EdDSA (current)]
```

## Kanban sync

```python
from daddy_agent.session_memory.kanban import move_card, read_board

move_card("./kanban.md", "CARD-17", from_col="In Progress", to_col="Done",
          session=handle)
```

`move_card` takes an `fcntl.flock` on the file and logs the move as a
`system` message on the session, so the Kanban state becomes replayable from
the memory graph.

## Checklist — enabling memory on a new agent

- [ ] Install deps: `uv pip install 'neo4j-agent-memory[mcp]'`.
- [ ] Export env vars: `NAM_NEO4J__URI`, `NAM_NEO4J__USER`,
      `NAM_NEO4J__PASSWORD`, `NAM_NEO4J__DATABASE=agent_memory`,
      `OPENAI_API_KEY`.
- [ ] Register `.claude/mcp_servers.json` with both MCP servers.
- [ ] Wrap the agent's main loop in `start_session` / `end_session`.
- [ ] Call `pull_context(task)` at the top of every task.
- [ ] `log_message` for every agent utterance (role = `"user"` | `"assistant"`
      | `"system"`).
- [ ] `log_reasoning` whenever a tool sequence represents a decision.
- [ ] `store_fact` / `invalidate_fact` for structured knowledge.
- [ ] On every Kanban mutation, call `move_card(..., session=handle)`.
- [ ] `cross_agent_query` before starting overlap-prone work.
