"""End-to-end tests for the FastAPI server using the in-process TestClient.

All Neo4j access is mocked — the tests are offline-safe.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.viz.conftest import FakeRecord


def _build_app(handler, **kwargs):
    from daddy_agent.viz.server import DriverFactory, create_app
    from tests.viz.conftest import FakeDriver

    factory = DriverFactory()
    factory._driver = FakeDriver(handler)  # type: ignore[attr-defined]
    return create_app(factory, **kwargs), factory


def test_graph_endpoint_shape_detail(sample_graph):
    """Detail view returns the full Sigma envelope (nodes + edges) plus the
    new ``view`` echo field. Edges include source/target/type."""

    def handler(cypher: str, params: dict[str, Any]) -> list[FakeRecord]:
        assert "MATCH (n)" in cypher
        return [FakeRecord({
            "nodes": sample_graph["nodes"][:2],
            "rels": sample_graph["edges"],
            "others": [sample_graph["nodes"][2]],
        })]

    app, _ = _build_app(handler)
    client = TestClient(app)
    r = client.get("/api/graph?db=codebase&view=detail&limit=50")
    assert r.status_code == 200
    body = r.json()
    assert {"nodes", "edges", "view"} <= set(body.keys())
    assert body["view"] == "detail"
    assert len(body["nodes"]) == 3
    for n in body["nodes"]:
        assert set(n.keys()) >= {"id", "label", "type", "attributes", "size", "degree"}
    assert {"source", "target", "type"} <= set(body["edges"][0].keys())


def test_graph_default_is_summary_view(sample_graph):
    """Without ``?view=`` we ship the summary view — Files-only, fewer
    nodes, IMPORTS/EXTENDS edges synthesised from edge_specs.
    """

    seen: list[dict[str, Any]] = []

    def handler(cypher: str, params: dict[str, Any]) -> list[FakeRecord]:
        seen.append({"cypher": cypher, "params": params})
        return [FakeRecord({
            "nodes": sample_graph["nodes"][:1],
            "others": [],
            "edge_specs": [],
        })]

    app, _ = _build_app(handler)
    r = TestClient(app).get("/api/graph?db=codebase")
    assert r.status_code == 200
    body = r.json()
    assert body["view"] == "summary"
    # Summary cypher targets File nodes specifically, not the generic
    # MATCH (n) of detail mode.
    assert "MATCH (f:File)" in seen[0]["cypher"]


def test_graph_summary_rejects_filters():
    """Filters silently doing nothing in summary mode would be a UX trap."""

    app, _ = _build_app(lambda c, p: [])
    r = TestClient(app).get("/api/graph?db=codebase&view=summary&type=Function")
    assert r.status_code == 400
    assert "detail-view" in r.json()["error"]


def test_graph_detail_community_filter_adds_param():
    seen: list[dict[str, Any]] = []

    def handler(cypher: str, params: dict[str, Any]) -> list[FakeRecord]:
        seen.append({"cypher": cypher, "params": params})
        return [FakeRecord({"nodes": [], "rels": [], "others": []})]

    app, _ = _build_app(handler)
    client = TestClient(app)
    r = client.get(
        "/api/graph?db=memory&view=detail&community=core&type=Function&limit=10"
    )
    assert r.status_code == 200
    call = seen[0]
    assert "n.community = $community" in call["cypher"]
    assert "'Function' IN labels(n)" in call["cypher"]
    assert call["params"]["community"] == "core"
    assert call["params"]["limit"] == 10


def test_graph_unknown_db_is_400():
    app, _ = _build_app(lambda c, p: [])
    client = TestClient(app)
    r = client.get("/api/graph?db=bogus")
    assert r.status_code == 400


def test_graph_rejects_label_outside_whitelist():
    """Pin: the round-1 fix hardened ``type=`` from an char-allowlist into
    a closed label whitelist. A regression to the allowlist would silently
    let a crafted label slip into the Cypher ``WHERE`` clause; this test
    catches that the moment the whitelist is bypassed.

    Detail view only — summary view rejects ``type=`` outright.
    """

    app, _ = _build_app(lambda c, p: [])
    client = TestClient(app)
    r = client.get("/api/graph?db=codebase&view=detail&type=NotARealLabel")
    assert r.status_code == 400
    assert "unknown node label" in r.json()["error"]
    r2 = client.get("/api/graph?db=codebase&view=detail&type=File;DROP")
    assert r2.status_code == 400


def test_graph_accepts_whitelisted_label():
    """Sanity partner to the negative test above."""

    seen: list[dict[str, Any]] = []

    def handler(cypher: str, params: dict[str, Any]) -> list[FakeRecord]:
        seen.append({"cypher": cypher, "params": params})
        return [FakeRecord({"nodes": [], "rels": [], "others": []})]

    app, _ = _build_app(handler)
    r = TestClient(app).get("/api/graph?db=codebase&view=detail&type=Function")
    assert r.status_code == 200
    assert "'Function' IN labels(n)" in seen[0]["cypher"]


def test_graph_db_unreachable_is_503():
    def boom(c, p):
        raise RuntimeError("connection refused")

    app, _ = _build_app(boom)
    client = TestClient(app)
    r = client.get("/api/graph?db=codebase")
    assert r.status_code == 503
    assert "connection refused" in r.json()["error"]


def test_search_endpoint_uses_params(sample_graph):
    seen: list[dict[str, Any]] = []

    def handler(c, p):
        seen.append({"cypher": c, "params": p})
        return [FakeRecord({"n": sample_graph["nodes"][0]})]

    app, _ = _build_app(handler)
    client = TestClient(app)
    r = client.get("/api/search?db=codebase&q=auth&limit=5")
    assert r.status_code == 200
    body = r.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["label"] == "a.py"
    call = seen[0]
    assert call["params"]["q"] == "auth"
    assert call["params"]["limit"] == 5


def test_neighbors_endpoint(sample_graph):
    nodes = sample_graph["nodes"]
    rels = sample_graph["edges"]

    def handler(c, p):
        assert p["id"] == "n:1"
        assert "elementId(n)" in c
        return [FakeRecord({"n": nodes[0], "neighbors": [nodes[1], nodes[2]], "rels": [rels]})]

    app, _ = _build_app(handler)
    client = TestClient(app)
    r = client.get("/api/node/n:1/neighbors?db=codebase&depth=2")
    assert r.status_code == 200
    body = r.json()
    ids = {n["id"] for n in body["nodes"]}
    assert "n:1" in ids and "n:2" in ids and "n:3" in ids
    assert any(e["source"] == "n:1" for e in body["edges"])


def test_index_html_served():
    app, _ = _build_app(lambda c, p: [])
    client = TestClient(app)
    r = client.get("/")
    assert r.status_code == 200
    assert "<html" in r.text.lower()


def test_static_css_served():
    app, _ = _build_app(lambda c, p: [])
    client = TestClient(app)
    r = client.get("/static/style.css")
    assert r.status_code == 200
    assert "--bg" in r.text
