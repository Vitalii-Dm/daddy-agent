# Codebase MCP Server

Exposes the Neo4j codebase knowledge graph to agents through the Model
Context Protocol.  The server is a stdio FastMCP process reading the
Neo4j connection details from environment variables.

## Environment

| Variable            | Default                  | Purpose                        |
|---------------------|--------------------------|--------------------------------|
| `NEO4J_URI`         | `bolt://localhost:7687`  | Bolt URL                       |
| `NEO4J_USER`        | `neo4j`                  | Neo4j user                     |
| `NEO4J_PASSWORD`    | `neo4j`                  | Neo4j password                 |
| `NEO4J_CODEBASE_DB` | `codebase`               | Database holding the code graph |

## Running

```bash
python -m daddy_agent.codebase_mcp
```

The process speaks MCP over stdio; it is meant to be launched by a
client such as Claude Code or any MCP-compatible agent harness.

## Tool reference

| Tool                | Inputs                                        | Returns                                               |
|---------------------|-----------------------------------------------|-------------------------------------------------------|
| `search_code`       | `query: str`, `limit: int = 20`               | List of `{kind, name, path, line, docstring}` hits    |
| `get_callers`       | `name: str`, `file_path: str \| null`         | List of `{name, file_path, line, signature}`          |
| `get_callees`       | `name: str`, `file_path: str \| null`         | List of `{name, file_path, line, signature}`          |
| `get_dependencies`  | `file_path: str`, `depth: int = 1`            | List of `{kind, name, depth}`                         |
| `get_community`     | `name: str`                                   | `{kind, name, community_id, community_label, community_description}` or `null` |
| `impact_analysis`   | `file_path: str`                              | `{files: [...], functions: [...], node_cap, truncated}` |
| `find_dead_code`    | `limit: int = 500`                            | List of `{name, file_path, line, signature}`          |
| `run_cypher`        | `query: str`, `params: object = {}`           | `{rows, row_count, truncated, row_cap}`               |

### `run_cypher` safety

`run_cypher` is **read-only**.  The server rejects any query that, after
stripping comments and string literals, contains any of:

- `CREATE`, `MERGE`, `DELETE`, `DETACH`, `SET`, `REMOVE`, `DROP`, `LOAD`,
  `FOREACH`, `START`, `USING PERIODIC COMMIT`
- mutating APOC / GDS / db procedures (`apoc.create.*`, `apoc.merge.*`,
  `apoc.refactor.*`, `apoc.periodic.*`, `apoc.load.*`,
  `apoc.cypher.doIt`, `apoc.export.*`, `apoc.import.*`,
  `gds.graph.project`, any `.write` procedure, `dbms.security.*`, ...)

The validator strips `//` line comments, `/* ... */` block comments,
string literals and backtick-quoted identifiers before tokenising, so
common bypass attempts are caught.  Row output is capped at 500 — the
envelope sets `truncated: true` when the cap hits.

## Example invocations

```json
{"name": "search_code", "arguments": {"query": "authenticate", "limit": 5}}
```

```json
{"name": "get_callers", "arguments": {"name": "process_payment"}}
```

```json
{
  "name": "get_dependencies",
  "arguments": {"file_path": "src/auth.py", "depth": 2}
}
```

```json
{
  "name": "impact_analysis",
  "arguments": {"file_path": "src/auth.py"}
}
```

```json
{
  "name": "run_cypher",
  "arguments": {
    "query": "MATCH (f:File)-[:IMPORTS]->(m) RETURN f.path, m.name LIMIT 10",
    "params": {}
  }
}
```

## Registration snippet (`.claude/mcp_servers.json`)

```jsonc
{
  "mcpServers": {
    "codebase-graph": {
      "command": "python",
      "args": ["-m", "daddy_agent.codebase_mcp"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "your-secure-password",
        "NEO4J_CODEBASE_DB": "codebase",
        "PYTHONPATH": "src"
      }
    }
  }
}
```

## Testing

```bash
PYTHONPATH=src pytest tests/codebase_mcp -q
ruff check src/daddy_agent/codebase_mcp tests/codebase_mcp
```

All tests mock the Neo4j driver, so the suite runs fully offline.
