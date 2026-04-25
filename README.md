# Daddy Agent

A new approach to task management with AI agent teams. Assemble agent teams with different roles that work autonomously in parallel, communicate with each other, create and manage their own tasks, review code, and collaborate across teams. You manage everything through a kanban board — like a CTO with an AI engineering team.

100% free, open source. No API keys. No configuration. Runs entirely locally.

## Quick Start

### Prerequisites

- **Node.js** 20+ and **pnpm** 9+
- **Python** 3.12 (not 3.14 — tree-sitter native extensions require 3.12)
- **Docker** (for Neo4j knowledge graph — optional)
- **Claude CLI** installed (`npm i -g @anthropic-ai/claude-code` or `brew install claude-code`)

### 1. Install & Run

```bash
# Install Node dependencies
pnpm install

# Start the development server
pnpm dev
```

The app opens automatically. You'll see the Aurora dashboard with a team selection grid.

### 2. Create & Launch a Team

1. Click **New Team** in the dashboard header
2. Name your team, add members with roles (developer, reviewer, etc.)
3. Select a working directory (your project)
4. Click **Create & Launch**
5. Watch the progress bar: Starting → Team Setup → Members Joining → Finalizing

**Or try the demo:** Click **Launch Solana Demo** in the team selection grid for a pre-configured trading desk with 4 agents and live price feeds.

### 3. Managing Teams

- **Stop Team** — red button in the header kills all agent processes
- **Switch Teams** — click "Teams /" in the header or "Home" in the top rail
- **Chat** — left panel sends messages directly to the team lead via stdin
- **Kanban** — drag tasks between columns (Backlog, In Progress, Review, Blocked, Done)
- **Cancel Launch** — cancel button available from the very start of provisioning

## Knowledge Graph (Optional)

The app includes a Neo4j-powered knowledge graph for codebase analysis and session memory visualization.

### Setup

```bash
# 1. Configure Neo4j credentials
cp .env.example .env
# Edit .env — set NEO4J_PASSWORD, and for Community Edition:
#   NEO4J_CODEBASE_DB=neo4j
#   NEO4J_MEMORY_DB=neo4j

# 2. Create Python venv (MUST use Python 3.12)
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# 3. Start Neo4j
docker compose up -d
# Wait for healthy, then:
make init-db

# 4. Index your codebase
NEO4J_PASSWORD=your-password .venv/bin/python3 -m daddy_agent.codebase_graph.indexer /path/to/project

# 5. Ingest session memory (past Claude Code conversations)
NEO4J_PASSWORD=your-password .venv/bin/python3 scripts/ingest_sessions_to_memory.py
```

### Using the Graph

Switch to the **Graph** tab in the Aurora dashboard:
- **Codebase tab** — file/function/class dependency graph with community coloring
- **Memory tab** — session history, entities extracted from conversations
- **Summary/Detail** toggle for graph density
- **Search** nodes by name
- Click nodes to expand neighbors

## Tech Stack

- **Electron** 40.x + **React** 19.x + **TypeScript** 5.x
- **Tailwind CSS** 3.x + Liquid Glass design system
- **Zustand** 4.x for state management
- **Neo4j** 5.x + **tree-sitter** for codebase analysis
- **FastAPI** (Python) for graph visualization server
- **claude-multimodel** for team orchestration

## Architecture

```
Electron Main Process
├── TeamProvisioningService    — spawns claude-multimodel, manages lifecycle
├── ClaudeBinaryResolver       — finds claude-multimodel in ~/.agent-teams/runtime-cache/
├── CliInstallerService        — CLI status, provider auth checks
├── ChangeExtractorService     — per-task code diff extraction
├── ReviewApplierService       — accept/reject hunks, three-way merge
├── KnowledgeGraphProxy        — proxies renderer ↔ Python viz server
└── PythonVizServer            — manages FastAPI sidecar lifecycle

Electron Renderer (Aurora Shell)
├── DashboardSection           — 2-column layout: chat left, roster+kanban right
├── TeamSelectionGrid          — team cards when no team selected
├── KanbanGlass                — 2+3 row drag-and-drop board
├── ChatColumn                 — activity stream + DM chat to lead
├── ChangeReviewDialog         — CodeMirror diff viewer with accept/reject
├── KnowledgeGraphView         — SVG force-directed graph with pan/zoom
└── TeamProvisioningPanel      — step progress bar with cancel

Python Sidecar
├── codebase_graph/            — tree-sitter AST parser + Neo4j ingester
├── session_memory/            — agent conversation entity extraction
└── viz/                       — FastAPI + SSE for graph queries
```

## Commands

```bash
pnpm dev              # Dev server with hot reload
pnpm build            # Production build
pnpm typecheck        # Type checking
pnpm test             # Run all tests
pnpm check            # Full quality gate (types + lint + test + build)

# Python
make up               # Start Neo4j
make down             # Stop Neo4j
make init-db          # Initialize databases
make test             # Run pytest
```

## Key Configuration

- **`~/.claude/claude-devtools-config.json`** — app settings
  - `multimodelEnabled: true` — use claude-multimodel for team orchestration
- **`~/.agent-teams/runtime-cache/`** — downloaded claude-multimodel binaries
- **`.env`** — Neo4j credentials (gitignored)

## License

MIT
