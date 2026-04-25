"""Tests for the Obsidian vault exporter.

The exporter is seeded with a small hand-built graph (no Neo4j required),
we run it twice against the same tmp_path, and assert:

  * every node has a markdown file with frontmatter + wikilinks,
  * README.md groups nodes by community,
  * byte-for-byte determinism across runs.
"""

from __future__ import annotations

import filecmp
from pathlib import Path

from daddy_agent.viz.obsidian_export import (
    Graph,
    GraphEdge,
    GraphNode,
    export_vault,
    fetch_graph,
    main,
    slugify,
)
from tests.viz.conftest import FakeDriver, FakeNode, FakeRecord, FakeRel


def _build_graph() -> Graph:
    nodes = [
        GraphNode(id="n:1", labels=["File"], properties={"name": "auth.py", "community": "security", "path": "src/auth.py"}),
        GraphNode(id="n:2", labels=["Function"], properties={"name": "login", "community": "security", "signature": "login()"}),
        GraphNode(id="n:3", labels=["Class"], properties={"name": "UserModel", "community": "models"}),
        GraphNode(id="n:4", labels=["Entity"], properties={"name": "JWT / Token", "community": "security"}),
    ]
    edges = [
        GraphEdge(source="n:1", target="n:2", type="DEFINES"),
        GraphEdge(source="n:2", target="n:3", type="USES"),
        GraphEdge(source="n:1", target="n:4", type="MENTIONS"),
    ]
    return Graph(nodes=nodes, edges=edges)


def test_slugify_handles_specials():
    assert slugify("JWT / Token") == "JWT_Token"
    assert slugify("  hello.world ") == "hello.world"
    assert slugify("") == "node"


def test_export_creates_files_with_frontmatter_and_wikilinks(tmp_path: Path):
    graph = _build_graph()
    written = export_vault(graph, tmp_path)
    # All files are under the vault
    assert len(written) == len(graph.nodes) + 1  # +README
    # Community dirs exist
    assert (tmp_path / "security").is_dir()
    assert (tmp_path / "models").is_dir()
    # Node file content
    auth_file = tmp_path / "security" / "auth.py.md"
    assert auth_file.exists()
    text = auth_file.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    assert 'name: "auth.py"' in text
    assert 'community: "security"' in text
    assert "[[login]]" in text  # wikilink to login function
    assert "DEFINES" in text
    # The JWT/Token entity should have a sanitised slug and a piped link.
    jwt_slug = slugify("JWT / Token")
    assert (tmp_path / "security" / f"{jwt_slug}.md").exists()
    assert f"[[{jwt_slug}|JWT / Token]]" in text
    # README lists everything grouped by community
    readme = (tmp_path / "README.md").read_text(encoding="utf-8")
    assert "## security" in readme and "## models" in readme
    assert "[[login|login]]" in readme or "[[login]]" in readme


def test_export_is_deterministic(tmp_path: Path):
    graph = _build_graph()
    run1 = tmp_path / "run1"
    run2 = tmp_path / "run2"
    export_vault(graph, run1)
    export_vault(graph, run2)

    diff = filecmp.dircmp(run1, run2)
    _assert_identical(diff)


def test_export_is_idempotent_in_place(tmp_path: Path):
    """Running the exporter twice into the same dir keeps content stable."""
    graph = _build_graph()
    export_vault(graph, tmp_path)
    first = _snapshot(tmp_path)
    export_vault(graph, tmp_path)
    second = _snapshot(tmp_path)
    assert first == second


def test_export_prunes_stale_files(tmp_path: Path):
    graph = _build_graph()
    export_vault(graph, tmp_path)
    stale = tmp_path / "security" / "stale.md"
    stale.write_text("stale\n", encoding="utf-8")
    export_vault(graph, tmp_path)
    assert not stale.exists()


def test_fetch_graph_reads_driver():
    a = FakeNode(1, ["File"], {"name": "a.py", "community": "core"})
    b = FakeNode(2, ["Function"], {"name": "run", "community": "core"})
    rel = FakeRel(10, "DEFINES", a, b, {})

    def handler(cypher: str, params):
        if "r]->(b)" in cypher:
            return [FakeRecord({"a": a, "r": rel, "b": b})]
        return [FakeRecord({"n": a}), FakeRecord({"n": b})]

    driver = FakeDriver(handler)
    graph = fetch_graph(driver, "codebase")
    assert {n.name for n in graph.nodes} == {"a.py", "run"}
    assert len(graph.edges) == 1
    assert graph.edges[0].type == "DEFINES"


def test_cli_runs_with_injected_driver(tmp_path: Path, monkeypatch):
    """Exercise the ``main()`` CLI path with the real driver builder monkey-patched."""
    a = FakeNode(1, ["File"], {"name": "a.py", "community": "core"})
    rel_record = FakeRecord({"n": a})

    def handler(cypher: str, params):
        if "r]->(b)" in cypher:
            return []
        return [rel_record]

    driver = FakeDriver(handler)
    monkeypatch.setattr("daddy_agent.viz.obsidian_export._cli_driver", lambda: driver)

    out = tmp_path / "vault"
    rc = main(["--format", "obsidian", "--output", str(out), "--db", "codebase"])
    assert rc == 0
    assert (out / "core" / "a.py.md").exists()
    assert (out / "README.md").exists()


def _snapshot(root: Path) -> dict:
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[str(p.relative_to(root))] = p.read_bytes()
    return out


def _assert_identical(diff: filecmp.dircmp) -> None:
    assert diff.left_only == [], f"unexpected extras on left: {diff.left_only}"
    assert diff.right_only == [], f"unexpected extras on right: {diff.right_only}"
    assert diff.diff_files == [], f"diff files: {diff.diff_files}"
    for sub in diff.subdirs.values():
        _assert_identical(sub)
