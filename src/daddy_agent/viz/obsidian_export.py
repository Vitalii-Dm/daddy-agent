"""Deterministic Obsidian vault export for a Neo4j knowledge graph.

Usage:
    export-graph --format obsidian --output ./vault/ --db codebase

Each ``File``/``Class``/``Function``/``Method``/``Entity`` node becomes a
markdown file under ``{vault}/{community}/{name}.md``. Wikilinks between
connected nodes preserve the graph topology, and YAML frontmatter carries the
node's properties. A top-level ``README.md`` lists every node grouped by
community.

The exporter is idempotent: running it twice against the same graph produces
byte-identical output. Output is sorted by node id to guarantee stable
ordering.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Graph model
# ---------------------------------------------------------------------------


@dataclass
class GraphNode:
    """Minimal node representation used by the exporter."""

    id: str
    labels: list[str]
    properties: dict[str, Any]

    @property
    def name(self) -> str:
        for key in ("name", "path", "id"):
            val = self.properties.get(key)
            if val:
                return str(val)
        return str(self.id)

    @property
    def primary_label(self) -> str:
        return self.labels[0] if self.labels else "Node"

    @property
    def community(self) -> str:
        return str(self.properties.get("community") or "uncategorised")


@dataclass
class GraphEdge:
    """Directed relationship between two nodes."""

    source: str
    target: str
    type: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class Graph:
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# ---------------------------------------------------------------------------
# Neo4j fetch
# ---------------------------------------------------------------------------


def fetch_graph(driver: Any, database: str) -> Graph:
    """Pull all nodes and edges from the given Neo4j database.

    ``driver`` must expose ``.session(database=...)`` — i.e. a real
    :class:`neo4j.Driver` or a test double.
    """
    nodes: dict[str, GraphNode] = {}
    edges: list[GraphEdge] = []
    with driver.session(database=database) as session:
        for rec in session.run("MATCH (n) RETURN n"):
            n = rec["n"]
            node_id = str(getattr(n, "element_id", None) or getattr(n, "id", ""))
            nodes[node_id] = GraphNode(
                id=node_id,
                labels=list(getattr(n, "labels", []) or []),
                properties={k: _plain(v) for k, v in (dict(n) if hasattr(n, "__iter__") else {}).items()},
            )
        for rec in session.run("MATCH (a)-[r]->(b) RETURN a, r, b"):
            a = rec["a"]
            b = rec["b"]
            r = rec["r"]
            src = str(getattr(a, "element_id", None) or getattr(a, "id", ""))
            dst = str(getattr(b, "element_id", None) or getattr(b, "id", ""))
            edges.append(GraphEdge(
                source=src,
                target=dst,
                type=getattr(r, "type", "REL"),
                properties={k: _plain(v) for k, v in (dict(r) if hasattr(r, "__iter__") else {}).items()},
            ))
    return Graph(nodes=list(nodes.values()), edges=edges)


def _plain(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return str(value)


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------


SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def slugify(text: str) -> str:
    """Filesystem-safe, deterministic slug for a node name."""
    s = SAFE_FILENAME_RE.sub("_", text.strip())
    s = s.strip("._-")
    return s or "node"


def _yaml_frontmatter(data: dict[str, Any]) -> str:
    """Tiny, deterministic YAML serialiser for our flat frontmatter."""
    lines = ["---"]
    for key in sorted(data):
        value = data[key]
        lines.append(f"{key}: {_yaml_value(value)}")
    lines.append("---")
    return "\n".join(lines)


def _yaml_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(_yaml_value(v) for v in value) + "]"
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    # Strings: always double-quote with JSON escaping for full determinism.
    return json.dumps(str(value))


def _index_nodes(nodes: Sequence[GraphNode]) -> tuple[dict[str, GraphNode], dict[str, str]]:
    """Build id->node and id->relative-wikilink maps."""
    by_id: dict[str, GraphNode] = {}
    slug_counts: dict[tuple[str, str], int] = {}
    link: dict[str, str] = {}
    for node in sorted(nodes, key=lambda n: n.id):
        by_id[node.id] = node
        community = slugify(node.community)
        base = slugify(node.name)
        key = (community, base)
        count = slug_counts.get(key, 0)
        slug_counts[key] = count + 1
        slug = base if count == 0 else f"{base}_{count}"
        link[node.id] = slug
    return by_id, link


def _render_node(
    node: GraphNode,
    link_map: dict[str, str],
    by_id: dict[str, GraphNode],
    outgoing: dict[str, list[GraphEdge]],
    incoming: dict[str, list[GraphEdge]],
) -> str:
    frontmatter = _yaml_frontmatter({
        "id": node.id,
        "name": node.name,
        "labels": node.labels,
        "community": node.community,
        "properties": node.properties,
    })
    parts: list[str] = [frontmatter, "", f"# {node.name}", ""]
    parts.append(f"**Type:** {node.primary_label}")
    parts.append(f"**Community:** {node.community}")
    parts.append("")

    def fmt_edges(edges: list[GraphEdge], direction: str) -> list[str]:
        rows: list[str] = []
        for e in sorted(edges, key=lambda x: (x.type, x.target, x.source)):
            other = e.target if direction == "out" else e.source
            other_node = by_id.get(other)
            if other_node is None:
                continue
            slug = link_map.get(other)
            if slug is None:
                continue
            label = other_node.name
            if slug == label:
                rows.append(f"- {e.type} → [[{slug}]]")
            else:
                rows.append(f"- {e.type} → [[{slug}|{label}]]")
        return rows

    out_rows = fmt_edges(outgoing.get(node.id, []), "out")
    in_rows = fmt_edges(incoming.get(node.id, []), "in")
    if out_rows:
        parts.append("## Outgoing")
        parts.extend(out_rows)
        parts.append("")
    if in_rows:
        parts.append("## Incoming")
        parts.extend(in_rows)
        parts.append("")
    # Always end with a single trailing newline.
    return "\n".join(parts).rstrip() + "\n"


def _render_readme(graph: Graph, link_map: dict[str, str]) -> str:
    by_community: dict[str, list[GraphNode]] = {}
    for node in graph.nodes:
        by_community.setdefault(node.community, []).append(node)
    lines: list[str] = ["# Knowledge Graph Vault", "",
                        f"Nodes: {len(graph.nodes)}  ",
                        f"Edges: {len(graph.edges)}", ""]
    for community in sorted(by_community):
        lines.append(f"## {community}")
        lines.append("")
        for node in sorted(by_community[community], key=lambda n: (n.name, n.id)):
            slug = link_map[node.id]
            lines.append(f"- [[{slug}|{node.name}]] — *{node.primary_label}*")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def export_vault(graph: Graph, output: Path) -> list[Path]:
    """Write the graph to ``output`` as an Obsidian vault.

    Returns the list of files written (for tests / CLI reporting).
    """
    output.mkdir(parents=True, exist_ok=True)

    by_id, link_map = _index_nodes(graph.nodes)
    outgoing: dict[str, list[GraphEdge]] = {}
    incoming: dict[str, list[GraphEdge]] = {}
    for edge in graph.edges:
        outgoing.setdefault(edge.source, []).append(edge)
        incoming.setdefault(edge.target, []).append(edge)

    # Compute the set of files we *will* write so we can prune stale ones.
    desired_files: dict[Path, str] = {}
    for node_id in sorted(by_id):
        node = by_id[node_id]
        community_dir = output / slugify(node.community)
        community_dir.mkdir(parents=True, exist_ok=True)
        path = community_dir / f"{link_map[node.id]}.md"
        desired_files[path] = _render_node(node, link_map, by_id, outgoing, incoming)
    desired_files[output / "README.md"] = _render_readme(graph, link_map)

    written: list[Path] = []
    for path in sorted(desired_files):
        content = desired_files[path]
        if path.exists():
            existing = path.read_text(encoding="utf-8")
            if existing == content:
                written.append(path)
                continue
        path.write_text(content, encoding="utf-8")
        written.append(path)

    # Prune stale files we previously wrote but which don't belong now.
    _prune_stale(output, set(desired_files))
    return written


def _prune_stale(output: Path, keep: Iterable[Path]) -> None:
    keep_set = {p.resolve() for p in keep}
    for md in output.rglob("*.md"):
        if md.resolve() not in keep_set:
            md.unlink()
    # Remove now-empty community directories.
    for sub in sorted(output.glob("*"), key=lambda p: len(p.parts), reverse=True):
        if sub.is_dir() and not any(sub.iterdir()):
            sub.rmdir()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _cli_driver() -> Any:
    from neo4j import GraphDatabase

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    pwd = os.environ.get("NEO4J_PASSWORD", "neo4j")
    return GraphDatabase.driver(uri, auth=(user, pwd))


def _resolve_db_name(alias: str) -> str:
    if alias == "codebase":
        return os.environ.get("NEO4J_CODEBASE_DB", "codebase")
    if alias == "memory":
        return os.environ.get("NEO4J_MEMORY_DB", "agent_memory")
    return alias


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="export-graph", description="Export a Neo4j graph.")
    parser.add_argument("--format", choices=["obsidian"], default="obsidian")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--db", default="codebase", help="codebase | memory | <real db>")
    parser.add_argument("--driver", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    driver = args.driver or _cli_driver()
    try:
        graph = fetch_graph(driver, _resolve_db_name(args.db))
    finally:
        if hasattr(driver, "close") and not args.driver:
            driver.close()
    files = export_vault(graph, args.output)
    print(f"wrote {len(files)} files to {args.output}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
