"""End-to-end tests for the FastAPI server using the in-process TestClient.

All Neo4j access is mocked — the tests are offline-safe.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi.testclient import TestClient

from tests.viz.conftest import FakeRecord


def _build_app(handler, **kwargs):
    from daddy_agent.viz.server import create_app, DriverFactory
    from tests.viz.conftest import FakeDriver

    factory = DriverFactory()
    factory._driver = FakeDriver(handler)  # type: ignore[attr-defined]
    return create_app(factory, **kwargs), factory


def test_graph_endpoint_shape(sample_graph):
    def handler(cypher: str, params: Dict[str, Any]) -> List[FakeRecord]:
        assert "MATCH (n)" in cypher
        # collect(DISTINCT n), collect(DISTINCT r), collect(DISTINCT m)
        return [FakeRecord({
            "nodes": sample_graph["nodes"][:2],
            "rels": sample_graph["edges"],
            "others": [sample_graph["nodes"][2]],
        })]

    app, _ = _build_app(handler)
    client = TestClient(app)
    r = client.get("/api/graph?db=codebase&limit=50")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"nodes", "edges"}
    assert len(body["nodes"]) == 3
    # All sigma fields present on nodes
    for n in body["nodes"]:
        assert set(n.keys()) >= {"id", "label", "type", "attributes"}
    # Edge has source/target
    assert {"source", "target", "type"} <= set(body["edges"][0].keys())


def test_graph_community_filter_adds_param():
    seen: List[Dict[str, Any]] = []

    def handler(cypher: str, params: Dict[str, Any]) -> List[FakeRecord]:
        seen.append({"cypher": cypher, "params": params})
        return [FakeRecord({"nodes": [], "rels": [], "others": []})]

    app, _ = _build_app(handler)
    client = TestClient(app)
    r = client.get("/api/graph?db=memory&community=core&type=Function&limit=10")
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


def test_graph_db_unreachable_is_503():
    def boom(c, p):
        raise RuntimeError("connection refused")

    app, _ = _build_app(boom)
    client = TestClient(app)
    r = client.get("/api/graph?db=codebase")
    assert r.status_code == 503
    assert "connection refused" in r.json()["error"]


def test_search_endpoint_uses_params(sample_graph):
    seen: List[Dict[str, Any]] = []

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
