# Project Plan: Neo4j Knowledge Graph System for TMUX Agent Manager

## Executive Summary

We are building two interconnected Neo4j knowledge graphs that power a TMUX-based multi-agent orchestration system. Agents (Claude Code, Codex CLI, Gemini CLI) run in TMUX panes, coordinate through a shared Kanban, and need two kinds of persistent, shared knowledge:

1. **Codebase Knowledge Graph** — A structural map of the repository: files, functions, classes, call chains, imports, dependencies, community clusters. Built with Tree-sitter AST parsing. Agents query this instead of re-reading the entire codebase every task.

2. **Session Memory Graph** — A temporal knowledge graph tracking agent interactions, decisions, learned facts, entity relationships, and reasoning traces across sessions. Agents write here as they work; other agents read to inherit context.

Both graphs live in a single Neo4j 5.x instance (separate databases) and are exposed to agents via MCP (Model Context Protocol) servers. A visualization layer provides interactive graph exploration for humans.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     TMUX Agent Manager                          │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │   Lead   │  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │       │
│  │ (orch.)  │  │ (claude) │  │ (codex)  │  │ (gemini) │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │             │
│       └──────────────┴──────┬───────┴──────────────┘             │
│                             │                                    │
│              Kanban task board (shared .md files)                │
└─────────────────────────────┼────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
     ┌────────▼─────────┐          ┌──────────▼────────┐
     │  Codebase MCP    │          │  Memory MCP       │
     │  Server          │          │  Server            │
     │  (graph-codebase │          │  (neo4j-agent-     │
     │   -mcp or        │          │   memory)          │
     │   CodeGraph)     │          │                    │
     └────────┬─────────┘          └──────────┬────────┘
              │ Cypher                         │ Cypher
     ┌────────▼──────────────────────────────  ▼────────┐
     │                Neo4j 5.x                         │
     │                                                  │
     │  ┌─────────────────┐   ┌──────────────────────┐ │
     │  │ DB: codebase    │   │ DB: agent_memory     │ │
     │  │                 │   │                      │ │
     │  │ Nodes:          │   │ Nodes:               │ │
     │  │  File           │   │  Session             │ │
     │  │  Function       │   │  Message             │ │
     │  │  Class          │   │  Entity (POLE+O)     │ │
     │  │  Method         │   │  Preference          │ │
     │  │  Module         │   │  ReasoningTrace      │ │
     │  │  Variable       │   │  ToolCall            │ │
     │  │                 │   │                      │ │
     │  │ Edges:          │   │ Edges:               │ │
     │  │  CALLS          │   │  MENTIONED_IN        │ │
     │  │  IMPORTS        │   │  RELATES_TO          │ │
     │  │  EXTENDS        │   │  DECIDED_BY          │ │
     │  │  IMPLEMENTS     │   │  SUPERSEDES          │ │
     │  │  HAS_METHOD     │   │  USED_TOOL           │ │
     │  │  DEPENDS_ON     │   │  VALID_FROM/UNTIL    │ │
     │  └─────────────────┘   └──────────────────────┘ │
     └──────────────────────────────────────────────────┘
              │                               │
     ┌────────▼─────────┐          ┌──────────▼────────┐
     │ Tree-sitter      │          │ Entity Extraction  │
     │ AST Parser       │          │ Pipeline           │
     │ (25+ languages)  │          │ spaCy → GLiNER     │
     │ + git hooks for  │          │ → LLM fallback     │
     │   incremental    │          │                    │
     │   updates        │          │                    │
     └──────────────────┘          └───────────────────┘
```

---

## Component 1: Codebase Knowledge Graph

### What It Does

Parses the entire repository into a structural graph. Instead of agents grepping and reading files, they query the graph: "what calls `processPayment`?", "show me the dependency chain from `auth.ts`", "which files changed together in git history?"

### Technology Stack

- **Parser**: Tree-sitter (deterministic, no LLM cost, 25+ languages)
- **Graph DB**: Neo4j 5.x, database name `codebase`
- **MCP Server**: `graph-codebase-mcp` (Python, exposes Cypher tools) OR `CodeGraphContext` (more mature, multi-backend)
- **Incremental Updates**: Git hooks fire on commit/save → re-parse only changed files and their dependents

### Neo4j Schema (Codebase)

```cypher
// Node types
(:File {path, language, hash, last_modified})
(:Function {name, signature, docstring, start_line, end_line, file_path})
(:Class {name, docstring, file_path})
(:Method {name, signature, class_name, file_path})
(:Module {name, path})
(:Variable {name, type, scope})
(:Community {id, label, description})  // auto-detected clusters

// Relationship types
(:Function)-[:CALLS]->(:Function)
(:File)-[:IMPORTS]->(:Module)
(:Class)-[:EXTENDS]->(:Class)
(:Class)-[:IMPLEMENTS]->(:Class)
(:Class)-[:HAS_METHOD]->(:Method)
(:Function)-[:USES]->(:Variable)
(:File)-[:BELONGS_TO]->(:Community)
(:File)-[:GIT_COUPLED {strength: float}]->(:File)  // files that change together
```

### MCP Tools to Expose

The codebase MCP server must expose at minimum these tools:

| Tool Name | Description | Example Query |
|-----------|-------------|---------------|
| `search_code` | Semantic + structural search | "find authentication logic" |
| `get_callers` | Who calls this function? | `get_callers("processPayment")` |
| `get_callees` | What does this function call? | `get_callees("handleRequest")` |
| `get_dependencies` | Import/dependency chain | `get_dependencies("auth.ts")` |
| `get_community` | Which cluster does this belong to? | `get_community("UserService")` |
| `impact_analysis` | What's affected if I change this? | `impact_analysis("validate.py")` |
| `find_dead_code` | Unreachable symbols | `find_dead_code()` |
| `run_cypher` | Raw Cypher for advanced queries | Any Cypher query |

### Build Steps

1. Set up Neo4j with Docker (see Infrastructure section)
2. Implement Tree-sitter parser for primary languages in the project
3. Build the ingestion pipeline: parse → extract nodes/edges → write to Neo4j
4. Implement git hook for incremental updates (hash-based diffing)
5. Build the MCP server exposing the tools above
6. Add community detection (Louvain or Leiden algorithm on the graph)
7. Add embedding generation for semantic search (optional, vector index in Neo4j)
8. Test with Claude Code: register the MCP server, query the graph

### Delivery Expectations

- **Parser must handle**: Python, TypeScript/JavaScript, Go, Rust at minimum. Tree-sitter grammars exist for all of these.
- **Incremental updates under 2 seconds** for typical file changes (re-parse changed file + update dependents).
- **Full repo index under 30 seconds** for a 500-file project.
- **MCP server response under 500ms** for typical queries (callers, dependencies).
- **Graph must be queryable while indexing** — no downtime during re-index.

---

## Component 2: Session Memory Graph

### What It Does

Tracks everything agents do and learn across sessions. When Worker 1 discovers that "the auth module uses JWT with RS256", that fact is stored in the graph. When Worker 2 starts a related task, the memory MCP auto-retrieves relevant context. The lead orchestrator can query: "what did Worker 1 decide about the database schema?" and get the reasoning trace.

### Technology Stack

- **Library**: `neo4j-agent-memory` (Neo4j Labs, pip installable, Apache 2.0)
- **Graph DB**: Neo4j 5.x, database name `agent_memory`
- **MCP Server**: Built into `neo4j-agent-memory[mcp]` (16 tools)
- **Entity Extraction**: Three-stage pipeline (spaCy → GLiNER → LLM fallback)
- **Enrichment**: Optional Wikipedia/Diffbot background enrichment

### Three Memory Layers

**Short-term memory** (conversation history):
- Every message from every agent session stored with embeddings
- Session IDs link messages to specific TMUX panes/agents
- Conversation summaries generated for long sessions
- Queryable by semantic similarity and by session

**Long-term memory** (knowledge graph):
- Entities extracted from conversations using POLE+O model:
  - **P**erson (team members, stakeholders)
  - **O**bject (files, modules, APIs, tools)
  - **L**ocation (services, endpoints, environments)
  - **E**vent (deployments, decisions, bugs found)
  - **O**rganization (teams, projects)
- Relationships inferred between entities
- Preferences tracked (coding style, architecture decisions)
- Temporal validity: facts have `valid_from` and `valid_until` timestamps
- When new info contradicts old info, old fact is invalidated but preserved

**Reasoning memory** (decision traces):
- Every tool call, its inputs, outputs, and outcome
- Chain of thought for significant decisions
- Links back to the messages and entities that triggered the reasoning
- Queryable: "why did Agent 2 choose PostgreSQL over MongoDB?"

### Neo4j Schema (Session Memory)

```cypher
// Short-term
(:Session {id, agent_id, pane_id, started_at, ended_at, summary})
(:Message {id, role, content, embedding, timestamp})
(:Session)-[:HAS_MESSAGE]->(:Message)
(:Message)-[:NEXT]->(:Message)

// Long-term (POLE+O entities)
(:Entity {name, type, subtype, summary, valid_from, valid_until})
(:Entity)-[:RELATES_TO {type, weight, valid_from}]->(:Entity)
(:Entity)-[:MENTIONED_IN]->(:Message)
(:Preference {category, preference, agent_id})

// Reasoning
(:ReasoningTrace {id, goal, outcome, timestamp})
(:ToolCall {name, input, output, duration_ms, success})
(:ReasoningTrace)-[:USED_TOOL]->(:ToolCall)
(:ReasoningTrace)-[:TRIGGERED_BY]->(:Message)
(:ReasoningTrace)-[:DECIDED_ABOUT]->(:Entity)
```

### MCP Tools (already built into neo4j-agent-memory)

The library ships with 16 MCP tools. Key ones for our use case:

| Tool | What It Does |
|------|-------------|
| `add_message` | Store a conversation message with auto-extraction |
| `search_memory` | Semantic search across all memory layers |
| `get_context` | Retrieve combined context for a prompt (auto-assembled) |
| `add_entity` | Manually store a known entity |
| `add_preference` | Store a learned preference |
| `get_entity_graph` | Traverse relationships around an entity |
| `add_reasoning_trace` | Log a decision with its reasoning |
| `search_reasoning` | Find past reasoning for similar problems |

### Agent Integration Pattern

Each TMUX agent should follow this lifecycle:

```
Session Start:
  1. Create session in memory graph (session_id = tmux_pane_id)
  2. Pull relevant context from memory graph for the assigned task
  3. Pull relevant code structure from codebase graph

During Work:
  4. Log significant messages to short-term memory
  5. When making a decision, log reasoning trace
  6. When discovering a fact, store as entity with temporal validity
  7. Query codebase graph before reading files (callers, deps, impact)

Session End:
  8. Generate session summary
  9. Bridge session data into permanent long-term graph
  10. Update entity summaries if they evolved during session
```

### Delivery Expectations

- **Message storage latency under 100ms** (async, non-blocking to agent work)
- **Context retrieval under 300ms** (combined short-term + long-term + reasoning)
- **Entity extraction runs in background** — never blocks the agent
- **Cross-agent queries work** — Worker 1 can query what Worker 2 learned
- **Temporal queries work** — "who was the tech lead in January?" vs "who is the tech lead now?"
- **Reasoning traces are human-readable** in Neo4j Browser

---

## Component 3: Visualization Layer

### Requirements

Agents need visual feedback. Humans monitoring the TMUX session need to see what the graph looks like. Three visualization outputs:

1. **Interactive Web Dashboard** (primary)
   - Force-directed graph using Sigma.js (WebGL, handles large graphs) or vis.js
   - Click nodes to expand neighbors
   - Filter by entity type, community, agent, time range
   - Served on `localhost:9749` or similar
   - Shows both codebase and session graphs (tab switch)

2. **Neo4j Browser** (for debugging/Cypher)
   - Already built into Neo4j at `localhost:7474`
   - Use for ad-hoc Cypher queries and graph exploration
   - No custom work needed

3. **Obsidian Vault Export** (for persistent documentation)
   - Generate markdown files from graph communities
   - Wikilinks between nodes
   - Auto-regenerate on graph changes
   - Useful as long-term project memory that survives Neo4j restarts

### Delivery Expectations

- Dashboard loads in under 3 seconds for graphs with 1000+ nodes
- Dashboard auto-refreshes when graph changes (SSE or WebSocket)
- Obsidian export runs as a CLI command: `export-graph --format obsidian --output ./vault/`

---

## Infrastructure

### Neo4j Setup

```bash
# Docker Compose (recommended)
# file: docker-compose.yml

services:
  neo4j:
    image: neo4j:5.26-community
    ports:
      - "7474:7474"   # Browser
      - "7687:7687"   # Bolt
    environment:
      - NEO4J_AUTH=neo4j/your-secure-password
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_server_memory_heap_max__size=1G
      - NEO4J_server_memory_pagecache_size=512M
      - NEO4J_dbms_security_procedures_unrestricted=apoc.*
    volumes:
      - neo4j_data:/data
      - neo4j_plugins:/plugins
    restart: unless-stopped

volumes:
  neo4j_data:
  neo4j_plugins:
```

```bash
# Start
docker compose up -d

# Verify
docker compose logs neo4j | tail -5
# Should see "Started"

# Create separate databases
cypher-shell -u neo4j -p your-secure-password \
  "CREATE DATABASE codebase IF NOT EXISTS"
cypher-shell -u neo4j -p your-secure-password \
  "CREATE DATABASE agent_memory IF NOT EXISTS"
```

### MCP Server Registration

```jsonc
// .claude/mcp_servers.json (or equivalent for your agent)
{
  "mcpServers": {
    "codebase-graph": {
      "command": "python",
      "args": ["src/mcp_server.py", "--codebase-path", "."],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "your-secure-password",
        "NEO4J_DATABASE": "codebase"
      }
    },
    "agent-memory": {
      "command": "uvx",
      "args": ["neo4j-agent-memory[mcp]", "mcp", "serve",
               "--password", "your-secure-password"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "NAM_NEO4J__DATABASE": "agent_memory"
      }
    }
  }
}
```

### Python Dependencies

```txt
# Core
neo4j>=5.15.0
tree-sitter>=0.21.0
tree-sitter-language-pack>=0.6.0
neo4j-agent-memory[all]>=0.1.0

# Entity extraction (for session memory)
spacy>=3.7.0
gliner>=0.2.0

# Visualization
sigma.js or vis-network (npm, for dashboard)

# MCP
mcp>=0.9.0

# Embeddings (pick one)
openai>=1.0.0           # OpenAI embeddings
sentence-transformers   # Local embeddings (no API cost)
```

---

## Development Phases

### Phase 1: Foundation (Week 1)
- [ ] Neo4j Docker setup with two databases
- [ ] Tree-sitter parser for primary project languages
- [ ] Basic ingestion pipeline: parse repo → write nodes/edges to Neo4j
- [ ] Verify graph in Neo4j Browser with manual Cypher queries
- [ ] Install `neo4j-agent-memory` and verify MCP server starts

### Phase 2: MCP Integration (Week 2)
- [ ] Build codebase MCP server with core tools (search, callers, deps, impact)
- [ ] Configure both MCP servers in agent config
- [ ] Test: agent queries codebase graph instead of reading files
- [ ] Test: agent stores/retrieves session memory
- [ ] Git hooks for incremental codebase graph updates

### Phase 3: Multi-Agent Coordination (Week 3)
- [ ] Session management: each TMUX pane gets a unique session ID
- [ ] Cross-agent memory queries working (Worker 1 reads Worker 2's findings)
- [ ] Lead agent uses memory graph to assign tasks based on what workers have learned
- [ ] Reasoning traces logged for significant decisions
- [ ] Kanban integration: task status reflected in session graph

### Phase 4: Visualization & Polish (Week 4)
- [ ] Interactive web dashboard (Sigma.js or vis.js)
- [ ] Dashboard shows both graphs with tab switching
- [ ] Obsidian vault export command
- [ ] Community detection on codebase graph (Louvain/Leiden)
- [ ] Performance optimization: query caching, index tuning
- [ ] Documentation and usage guide

---

## Quality Gates

Each phase must pass before proceeding:

**Phase 1 Gate**: Run `MATCH (n) RETURN labels(n), count(n)` on both databases. Codebase graph has nodes. Memory graph stores and retrieves a test message.

**Phase 2 Gate**: An agent in a TMUX pane can call `get_callers("someFunctionName")` via MCP and get correct results. Agent can store a message and retrieve it via `search_memory`.

**Phase 3 Gate**: Two agents running in separate TMUX panes. Worker 1 stores a fact. Worker 2 retrieves it without being told explicitly. Lead agent can query "what has Worker 1 done this session?"

**Phase 4 Gate**: Dashboard renders the codebase graph with clickable nodes. A human can open it in a browser and navigate the code structure. Obsidian export creates a valid vault with working wikilinks.

---

## Key Design Decisions

1. **Neo4j over NetworkX**: Multiple agents need concurrent read/write access to the same graph. NetworkX is in-process Python only. Neo4j provides ACID transactions, Bolt protocol for concurrent access, and built-in visualization.

2. **Two databases, one instance**: Separation of concerns. Codebase graph is rebuilt from source code (disposable). Session memory is accumulated knowledge (precious). Different backup strategies, different schemas, no cross-contamination.

3. **Tree-sitter over LLM-based parsing**: Deterministic, zero cost, sub-second parsing. No hallucinated code structure. LLMs are used only for semantic enrichment (optional) and entity extraction from conversations.

4. **MCP over direct Neo4j access**: Agents should not write raw Cypher. MCP provides a controlled, tool-based interface with input validation, rate limiting, and consistent error handling. It also means we can swap the graph backend later without changing agent code.

5. **Temporal validity on session facts**: Facts change. "The API uses REST" might become "The API is migrating to GraphQL." Old facts are invalidated but preserved, so we maintain full history and can answer temporal queries.

6. **Three-stage entity extraction (spaCy → GLiNER → LLM)**: Fast path first (spaCy, 5ms), then zero-shot transformer (GLiNER, 50ms), LLM only for complex cases (500ms). Keeps costs low while maintaining quality. Configurable merge strategy.

---

## Reference Projects

Study these before building:

| Project | What to Learn | Link |
|---------|--------------|------|
| `neo4j-agent-memory` | Session memory schema, MCP tools, extraction pipeline | github.com/neo4j-labs/agent-memory |
| `graph-codebase-mcp` | Codebase graph schema, Tree-sitter → Neo4j pipeline | github.com/eric050828/graph-codebase-mcp |
| `CodeGraphContext` | Multi-language parsing, MCP server, CLI toolkit | github.com/CodeGraphContext/CodeGraphContext |
| `Axon` | Visualization dashboard, community detection, git coupling | github.com/harshkedia177/axon |
| `Graphify` | Multi-modal graph, Leiden clustering, Obsidian export | github.com/safishamsi/graphify |
| `codebase-memory-mcp` | High-performance C implementation, 66 languages, 3D viz | github.com/DeusData/codebase-memory-mcp |
| `Graphiti` (Zep) | Temporal knowledge graphs, validity windows, episodic memory | github.com/getzep/graphiti |
| `Cognee` | Claude Code lifecycle hooks, session-aware memory | github.com/topoteretes/cognee |

---

## Success Criteria

The system is done when:

1. A new agent starting a session receives relevant context from both graphs automatically — it knows the code structure AND what previous agents have done.
2. An agent modifying `auth.ts` is told by the codebase graph that 47 functions depend on it, before it makes the change.
3. When Agent 1 discovers a bug pattern, Agent 2 working on a similar file is alerted via the memory graph.
4. A human can open the dashboard, click on any function node, and see its callers, callees, test coverage, and which agents have touched it.
5. The Kanban board and memory graph are in sync — completing a task updates both.
6. The system survives TMUX session restarts, SSH disconnects, and agent crashes — Neo4j persists everything.
