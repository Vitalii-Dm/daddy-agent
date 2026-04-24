# daddy-agent

Two interconnected Neo4j knowledge graphs for a TMUX-based multi-agent orchestrator. A **codebase graph** maps files, functions, classes, calls, imports and communities using Tree-sitter AST parsing. A **session memory graph** tracks agent conversations, extracted entities (POLE+O), preferences and reasoning traces with temporal validity. Both graphs live in a single Neo4j 5.x instance (separate databases) and are exposed to agents over MCP.

Agents (Claude Code, Codex CLI, Gemini CLI) running in TMUX panes query these graphs instead of re-reading the repository or re-deriving context. A visualization layer renders both graphs for humans.

## Quickstart

```bash
# 1. Configure secrets
cp .env.example .env
$EDITOR .env   # set NEO4J_PASSWORD and OPENAI_API_KEY

# 2. Install Python deps (editable)
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 3. Start Neo4j and create databases
make up
make init-db

# 4. Sanity checks
python -c "import daddy_agent; print(daddy_agent.__version__)"
make test
make lint
```

Neo4j Browser is then at http://localhost:7474 (bolt on 7687).

## Directory layout

```
.
├── docker-compose.yml          # Neo4j 5.26-community + APOC
├── pyproject.toml              # hatchling, entry points for daddy-* CLIs
├── Makefile                    # up/down/logs/init-db/test/fmt/lint/clean
├── scripts/init-databases.sh   # idempotent database bootstrap
├── src/daddy_agent/
│   ├── __init__.py             # __version__
│   ├── neo4j_client.py         # shared driver/session helper (W1)
│   ├── codebase_graph/         # Tree-sitter ingestion (W2)
│   ├── codebase_mcp/           # codebase MCP server (W3)
│   ├── session_memory/         # agent memory glue (W4)
│   └── viz/                    # FastAPI + Sigma.js dashboard (W5)
├── tests/                      # pytest suite
└── PLAN-neo4j-knowledge-graphs.md
```

## How the five components fit together

1. **W1 — Infrastructure & Foundation (this package)**: Neo4j container, project skeleton, shared `neo4j_client`, CLI entry points, dev tooling.
2. **W2 — Codebase Ingestion**: Tree-sitter parsers walk the repo and write File/Function/Class/Method nodes + CALLS/IMPORTS/EXTENDS edges into the `codebase` database. Git hooks trigger incremental re-parses.
3. **W3 — Codebase MCP Server**: Exposes `search_code`, `get_callers`, `get_callees`, `get_dependencies`, `get_community`, `impact_analysis`, `find_dead_code`, `run_cypher` over the MCP protocol so agents can query without raw Cypher.
4. **W4 — Session Memory**: Wraps `neo4j-agent-memory` (POLE+O entities, temporal validity, reasoning traces) writing to the `agent_memory` database. Provides the second MCP server.
5. **W5 — Visualization**: FastAPI backend + Sigma.js frontend to render either graph interactively, plus an Obsidian vault exporter for persistent human-readable docs.

All five components depend on W1 for Neo4j connectivity and the Python package layout.

## Reference

See [`PLAN-neo4j-knowledge-graphs.md`](./PLAN-neo4j-knowledge-graphs.md) for the full architecture, schemas, MCP tool catalog, delivery expectations and phase gates.
