# Knowledge Graph — guide for Claude agents

This is the operator-facing manual for the Aurora `Knowledge graph` panel.
Read it when a user asks you to "open the graph", "index a project", "look at
the codebase graph", or anything similar.

## What it is

A live view of two Neo4j graphs that the app builds and queries:

- **`codebase`** — files, functions, classes, methods, imports, and call edges
  parsed by Tree-sitter. Scoped per-project via the `project_root` namespace
  (every node is tagged with the absolute path of the repo it was indexed from).
- **`memory`** — sessions, messages, entities, preferences, reasoning traces,
  tool calls. Built up over time as agents interact with users. Currently
  global per Neo4j instance (no per-project scoping yet).

The renderer never speaks HTTP. It calls IPC handlers on the Electron main
process which proxies to a locally-spawned Python FastAPI sidecar
(`daddy_agent.viz`).

## Bringing the graph up — preconditions

1. **Neo4j Community Edition running.**
   ```bash
   docker compose up -d neo4j
   docker exec daddy-agent-neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "RETURN 1"
   ```
   If `cypher-shell` is rate-limited (`AuthenticationRateLimit`), the user has
   tripped the lockout — restart the container: `docker restart daddy-agent-neo4j`.

2. **`.env` populated** at repo root with `NEO4J_URI`, `NEO4J_USER`,
   `NEO4J_PASSWORD`. The Electron main process reads these and forwards them
   to the Python sidecar (Electron does **not** auto-load .env; the KG-specific
   loader in `src/main/index.ts` does it for KG vars only).

3. **Python `daddy_agent` package importable.** The lifecycle service prefers
   `.venv/bin/python3` then `.venv-check/bin/python3` then PATH. If neither
   venv exists, install editable:
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -e .
   ```

4. **An active project picked in the Aurora UI.** The codebase tab is scoped
   to the active project's path. Without one, the panel shows the
   "Pick a project to see its graph" empty state. Memory tab works without
   a project.

## Activating the graph for a new project

The user's flow:

1. Open the project in Aurora (it must appear in `~/.claude/projects/...`,
   created automatically when Claude Code touches the repo).
2. Scroll to the `Knowledge graph` panel.
3. If the project hasn't been indexed yet, the panel shows
   **"This project hasn't been indexed yet"** with an `Index this project`
   button. Click it. Behind the scenes this calls
   `window.electronAPI.knowledgeGraph.reindex({ projectRoot })`, which spawns:
   ```
   python3 -m daddy_agent.codebase_graph.indexer <projectRoot> --project-root <projectRoot>
   ```
4. When the spawn exits cleanly, the panel re-queries and renders the graph.

## API surface (renderer side)

`window.electronAPI.knowledgeGraph`:

| Method | Purpose |
|---|---|
| `query({ db, view, limit, type, community, hubThreshold, projectRoot })` | Fetch the graph. `view: 'summary'` (Files + IMPORTS, hub-culled) or `'detail'` (raw nodes). |
| `search({ db, q, limit, projectRoot })` | Substring search across `name` / `path`. |
| `neighbors({ nodeId, db, depth, projectRoot })` | 1–3 hop expansion around a node. Module nodes (global) pass through any project filter. |
| `getHealth()` | `{ serverStatus, neo4jStatus, port, pid, lastError }`. |
| `start()` / `stop()` | Subprocess lifecycle. Idempotent. |
| `reindex({ projectRoot, full })` | Spawn the indexer for a path. |
| `onEvent(cb)` | Live SSE: `graph-updated`, `error`, `connection`. |

`projectRoot` is **always** the absolute path of the active project for the
codebase tab (the renderer reads it from `useStore(s => s.selectedProjectId)`
→ `projects.find(p => p.id === id).path`). Passing it scopes every Cypher
query to that project's nodes.

## Multi-project semantics

Neo4j Community Edition collapses both DB aliases (`codebase`, `memory`) to a
single physical database. To make the two tabs return distinct data the
server filters by **label family** at query time:

- `db=codebase` → File / Function / Class / Method / Module / Variable /
  Community labels.
- `db=memory` → Session / Message / Entity / Preference / ReasoningTrace /
  ToolCall labels.

Multiple repos live in one Neo4j instance via `project_root` on every
codebase-side node:

```cypher
MATCH (f:File {project_root: '/Users/dima/foo-app'}) RETURN f LIMIT 10
```

Module nodes (e.g. `os`, `pathlib`) are intentionally **global** — they're
shared across projects so importing the same stdlib from project A and
project B points at the same Module node.

## Common failure modes — diagnostic flow

1. **Panel shows "Couldn't load the knowledge graph" with `connection refused`** →
   Neo4j isn't running. `docker compose up -d neo4j`.

2. **`AuthenticationRateLimit`** in the error → Neo4j auth lockout from a
   previous bad password. `docker restart daddy-agent-neo4j` to clear.

3. **Sidecar status `crashed`, `lastError` mentions `ModuleNotFoundError:
   No module named 'daddy_agent'`** → Python venv missing or stale.
   `pip install -e .` in the project venv.

4. **Empty graph after indexing succeeded** → The project has no Tree-sitter-
   parseable files (only `.py`, `.ts`, `.tsx`, `.js` are recognised today; see
   `LANGUAGE_BY_SUFFIX` in `src/daddy_agent/codebase_graph/parser.py`).

5. **Graph mirrors another project's data** → Should not happen post-W18. If
   it does: confirm `project_root` is being sent (`/api/graph?project_root=…`
   in the dev tools network tab). Likely a stale renderer bundle — Cmd-R.

## CLI escape hatches

For headless ingestion / power-user flows:

```bash
# Index the active repo (project_root defaults to abs path of <root>)
.venv/bin/python3 -m daddy_agent.codebase_graph.indexer /path/to/repo

# Index with explicit project tag
.venv/bin/python3 -m daddy_agent.codebase_graph.indexer ./ --project-root /Users/dima/foo

# Force re-ingest every file (drops the hash short-circuit)
.venv/bin/python3 -m daddy_agent.codebase_graph.indexer ./ --full

# Hit the sidecar directly (bypasses Electron IPC)
curl 'http://127.0.0.1:9750/healthz'
curl 'http://127.0.0.1:9750/api/graph?db=codebase&project_root=/Users/dima/foo'
```

## When to recommend re-indexing

- After a large refactor (renaming files / moving modules).
- After deleting a directory the indexer previously walked (the incremental
  pass detects deletions, but if you reset Neo4j you'll need a fresh full pass).
- If the graph looks stale relative to current code — kick a `--full` index.

## Don't

- Don't write to the codebase graph from agent code paths. The MCP server
  exposes **read-only** Cypher; mutations belong in `ingester.py` so they're
  schema-respecting and idempotent.
- Don't rely on absolute paths in `File.path`. Paths are repo-relative; the
  absolute form lives in `project_root`.
- Don't query the codebase graph without `project_root` from production code
  paths. The CLI accepts it as optional for ad-hoc exploration; the renderer
  always sends it.
