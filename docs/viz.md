# Visualization Layer

This document covers the three visualization outputs produced by
`daddy_agent.viz`:

1. **Interactive web dashboard** (FastAPI + Sigma.js)
2. **Neo4j Browser** (third-party, no custom code)
3. **Obsidian vault export** (CLI)

---

## Web Dashboard

### Running

```bash
# Development (auto-reload)
python -m daddy_agent.viz --reload

# Production (defaults: localhost:9749)
python -m daddy_agent.viz
```

Environment variables:

| Name | Default | Purpose |
|------|---------|---------|
| `NEO4J_URI` | `bolt://localhost:7687` | Bolt URI |
| `NEO4J_USER` | `neo4j` | Username |
| `NEO4J_PASSWORD` | `neo4j` | Password |
| `NEO4J_CODEBASE_DB` | `codebase` | Codebase graph DB name |
| `NEO4J_MEMORY_DB` | `agent_memory` | Session memory DB name |

### Layout

The dashboard is a single page split into three columns:

```
+---------------------------------------------------------------+
| Top bar: title, tab switch (Codebase / Memory), status pill   |
+-----------+----------------------------------+----------------+
| Filters   |                                  |  Node details  |
|  - type   |     Sigma.js WebGL canvas         |  - properties  |
|  - comm.  |   (force-directed layout)         |  - neighbors   |
|  - search |                                  |                |
|           |                                  |                |
+-----------+----------------------------------+----------------+
```

> Screenshot placeholder: `docs/viz-dashboard.png` — once captured, drop a
> PNG at that path. The screenshot should show the codebase graph with one
> node selected and the details panel populated.

### Endpoints

| Path | Description |
|------|-------------|
| `GET /` | Serves `static/index.html` |
| `GET /healthz` | `{"status":"ok"}` or 503 with `reason` |
| `GET /api/graph?db=...&limit=...&community=...&type=...` | Sigma-compatible `{nodes, edges}` |
| `GET /api/search?db=...&q=...&limit=20` | Node search by name/label |
| `GET /api/node/{id}/neighbors?db=...&depth=1` | Click-to-expand |
| `GET /events` | Server-Sent-Events stream with `graph-updated` + heartbeats |

The SSE stream polls both databases every 5s (`tick_interval` in
`create_app`) and emits a `graph-updated` event when the node **or edge**
count changes on either graph — pure property edits that preserve both
counts are still missed (acceptable at a 5s poll).  Heartbeats
(`: heartbeat N`) fire every tick so load-balancers keep the connection
open.  When the DB is unreachable, the stream emits `event: error` with
the failure reason instead of a stale last-known signature.

### CDN Version Pinning Policy

The dashboard loads three libraries from `cdn.jsdelivr.net`. Versions are
pinned to a specific semver tag — **never** use `latest` or a floating
major. Update by bumping the version string **in both** `static/index.html`
and this table, then re-test the "Filter / click / expand / SSE refresh"
flow.

| Library | Current pin | Upstream |
|---------|-------------|----------|
| `sigma` | `3.0.1` | https://github.com/jacomyal/sigma.js |
| `graphology` | `0.25.4` | https://github.com/graphology/graphology |
| `graphology-layout-forceatlas2` | `0.10.1` | https://github.com/graphology/graphology |

A future enhancement would vendor these into `static/` to remove the CDN
runtime dependency.

---

## Obsidian Vault Export

```bash
# Export the codebase graph into ./vault
python -m daddy_agent.viz.obsidian_export \
  --format obsidian \
  --output ./vault \
  --db codebase

# Or the memory graph
python -m daddy_agent.viz.obsidian_export \
  --format obsidian \
  --output ./memory-vault \
  --db memory
```

Layout:

```
vault/
├── README.md          # grouped index (by community)
├── <community>/
│   ├── <node>.md      # YAML frontmatter + wikilinks
│   └── ...
└── ...
```

The exporter is deterministic: running it twice produces byte-identical
output, and stale markdown files from a previous export are pruned when the
graph changes. Open the folder in Obsidian — wikilinks `[[name]]` resolve
to sibling / cross-community node files.

### Frontmatter schema

```yaml
---
community: "security"
id: "n:1"
labels: ["File"]
name: "auth.py"
properties: {"name": "auth.py", "path": "src/auth.py", "community": "security"}
---
```

Properties are JSON-serialised for total determinism across runs.

---

## Neo4j Browser

No custom code. Browse `http://localhost:7474` with the credentials from
your `docker-compose.yml`. Use it for ad-hoc Cypher (`MATCH (n) RETURN n
LIMIT 25`) and debugging.
