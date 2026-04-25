"""FastAPI server backing the Sigma.js knowledge-graph dashboard.

Exposes a small REST + Server-Sent-Events surface around the two Neo4j
databases (``codebase`` and ``agent_memory``). The server is intentionally
resilient: if the database is unreachable the HTTP endpoints return ``503``
with a descriptive reason rather than crashing the process.

Environment variables
---------------------
NEO4J_URI            Bolt URI, default ``bolt://localhost:7687``.
NEO4J_USER           Username, default ``neo4j``.
NEO4J_PASSWORD       Password, default ``neo4j``.
NEO4J_CODEBASE_DB    Database name for the codebase graph, default ``codebase``.
NEO4J_MEMORY_DB      Database name for the memory graph, default ``agent_memory``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterator, Callable, Iterable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Neo4j driver lifecycle
# ---------------------------------------------------------------------------

# Mapping of logical DB name -> env variable that overrides the database name.
DB_ENV_MAP: dict[str, str] = {
    "codebase": "NEO4J_CODEBASE_DB",
    "memory": "NEO4J_MEMORY_DB",
}
DB_DEFAULTS: dict[str, str] = {
    "codebase": "codebase",
    "memory": "agent_memory",
}


def _env_driver() -> Any:
    """Build a Neo4j driver from ``NEO4J_{URI,USER,PASSWORD}`` env vars.

    Centralised so the viz server and the Obsidian CLI use identical
    defaults. The ``neo4j`` package is imported lazily to keep this module
    importable in test envs that don't install the driver.
    """
    from neo4j import GraphDatabase

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    pwd = os.environ.get("NEO4J_PASSWORD", "neo4j")
    return GraphDatabase.driver(uri, auth=(user, pwd))

# Closed whitelist of Cypher labels accepted by the /api/graph `type` filter.
# Mirrors the labels defined in PLAN-neo4j-knowledge-graphs.md for both
# databases; anything outside this set is a 400 — see api_graph.
ALLOWED_NODE_LABELS: frozenset[str] = frozenset(
    {
        # codebase graph
        "File",
        "Function",
        "Class",
        "Method",
        "Module",
        "Variable",
        "Community",
        # agent-memory graph
        "Session",
        "Message",
        "Entity",
        "Preference",
        "ReasoningTrace",
        "ToolCall",
    }
)


def _resolve_db(db: str) -> str:
    """Translate a logical DB name (``codebase``/``memory``) to the real one."""
    if db not in DB_ENV_MAP:
        raise HTTPException(status_code=400, detail=f"unknown db: {db}")
    return os.environ.get(DB_ENV_MAP[db], DB_DEFAULTS[db])


class DriverFactory:
    """Lazy, resilient wrapper around :class:`neo4j.GraphDatabase`.

    We keep the driver creation in a callable so that tests can monkey-patch
    ``_create_driver`` without importing the real ``neo4j`` package.
    """

    def __init__(self) -> None:
        self._driver: Any = None
        self._last_error: str | None = None

    def _create_driver(self) -> Any:
        # Kept as a method so tests can monkey-patch it per-instance.
        return _env_driver()

    def get(self) -> Any:
        if self._driver is None:
            self._driver = self._create_driver()
        return self._driver

    def close(self) -> None:
        if self._driver is not None:
            try:
                self._driver.close()
            except Exception:  # pragma: no cover - defensive
                log.exception("error closing neo4j driver")
            self._driver = None

    def reset(self) -> None:
        """Discard the current driver so the next call recreates it."""
        self.close()


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def _node_to_sigma(node: Any) -> dict[str, Any]:
    """Convert a neo4j Node-like object into a Sigma.js node dict."""
    # Neo4j Node exposes ``.id``, ``.labels`` and supports dict iteration.
    nid = getattr(node, "element_id", None) or str(getattr(node, "id", ""))
    labels = list(getattr(node, "labels", []) or [])
    props = dict(node) if hasattr(node, "__iter__") else {}
    label = props.get("name") or props.get("path") or props.get("id") or nid
    return {
        "id": str(nid),
        "label": str(label),
        "type": labels[0] if labels else "Node",
        "labels": labels,
        "community": props.get("community"),
        "attributes": {k: _jsonable(v) for k, v in props.items()},
    }


def _rel_to_sigma(rel: Any) -> dict[str, Any]:
    rid = getattr(rel, "element_id", None) or str(getattr(rel, "id", ""))
    start = getattr(rel, "start_node", None)
    end = getattr(rel, "end_node", None)
    s_id = getattr(start, "element_id", None) or str(getattr(start, "id", ""))
    e_id = getattr(end, "element_id", None) or str(getattr(end, "id", ""))
    return {
        "id": str(rid),
        "source": str(s_id),
        "target": str(e_id),
        "type": getattr(rel, "type", "REL"),
        "attributes": {k: _jsonable(v) for k, v in (dict(rel) if hasattr(rel, "__iter__") else {}).items()},
    }


def _jsonable(value: Any) -> Any:
    """Coerce neo4j-returned values into something JSON-serialisable."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return str(value)


def _run(driver: Any, db: str, cypher: str, **params: Any) -> list[dict[str, Any]]:
    """Execute a Cypher query and return the records as dicts.

    ``db`` is the *resolved* database name (not the ``codebase``/``memory``
    alias) so the caller has already mapped it.
    """
    session_kwargs: dict[str, Any] = {"database": db} if db else {}
    with driver.session(**session_kwargs) as session:
        result = session.run(cypher, **params)
        return [dict(record) for record in result]


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(
    driver_factory: DriverFactory | None = None,
    *,
    tick_interval: float = 5.0,
    ticker: Callable[[], Iterable[None]] | None = None,
) -> FastAPI:
    """Build a FastAPI app.

    Parameters
    ----------
    driver_factory:
        Optional :class:`DriverFactory` — allows tests to inject a mock.
    tick_interval:
        Polling interval (seconds) for the SSE ``graph-updated`` watcher.
    ticker:
        Optional async generator used by tests to simulate the passage of
        time without actual ``asyncio.sleep`` calls.
    """
    factory = driver_factory or DriverFactory()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            factory.close()

    app = FastAPI(title="Daddy Agent Graph Viz", version="0.1.0", lifespan=lifespan)
    app.state.driver_factory = factory
    app.state.tick_interval = tick_interval
    app.state.ticker = ticker

    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # ------------------------------------------------------------------
    # Root / static
    # ------------------------------------------------------------------
    @app.get("/")
    def index() -> Any:
        index_path = STATIC_DIR / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="index.html missing")
        return FileResponse(str(index_path))

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    @app.get("/healthz")
    def healthz() -> JSONResponse:
        try:
            driver = factory.get()
            verify = getattr(driver, "verify_connectivity", None)
            if verify is not None:
                verify()
            return JSONResponse({"status": "ok"})
        except Exception as exc:  # pragma: no cover - defensive path
            return JSONResponse(
                status_code=503,
                content={"status": "unavailable", "reason": str(exc)},
            )

    # ------------------------------------------------------------------
    # Graph
    # ------------------------------------------------------------------
    # Closed whitelist of view modes — Cypher cannot parametrise label
    # patterns / rel types, so we hard-code the templates per mode.
    SUMMARY_VIEW_CYPHER = (
        # Files + Modules they import, plus class EXTENDS/IMPLEMENTS.
        # We deliberately do NOT synthesise File-File edges via a shared
        # Module — that produces an O(n²) hairball ("every file imports
        # logging therefore every file connects to every file").  Showing
        # the Module nodes inline keeps the architecture readable: a
        # tight cluster around "logging" tells you the same story without
        # 1500 spurious edges.
        "MATCH (f:File) "
        "WITH f LIMIT $limit "
        "OPTIONAL MATCH (f)-[:IMPORTS]->(m:Module) "
        "WITH collect(DISTINCT f) AS files, collect(DISTINCT m) AS modules "
        "UNWIND files AS f1 "
        "OPTIONAL MATCH (f1)-[r]->(o) "
        "WHERE type(r) IN ['IMPORTS','EXTENDS','IMPLEMENTS'] "
        "  AND (o:File OR o:Module OR o:Class) "
        "WITH files, modules, "
        "     collect(DISTINCT { source: f1, target: o, type: type(r) }) AS specs "
        "RETURN files + [m IN modules WHERE m IS NOT NULL] AS nodes, "
        "       [] AS others, "
        "       [e IN specs WHERE e.target IS NOT NULL] AS edge_specs"
    )

    DETAIL_VIEW_CYPHER_TEMPLATE = (
        "MATCH (n) {where_clause} "
        "WITH n LIMIT $limit "
        "OPTIONAL MATCH (n)-[r]->(m) "
        "RETURN collect(DISTINCT n) AS nodes, collect(DISTINCT r) AS rels, "
        "       collect(DISTINCT m) AS others"
    )

    def _annotate_with_degree(
        nodes: dict[str, dict[str, Any]], edges: list[dict[str, Any]]
    ) -> None:
        """Drive Sigma's node size from its in+out degree.

        A flat graph is hard to read; weighting by degree makes the
        important nodes (most-imported files, most-called functions)
        pop visually without a separate centrality query.
        """
        deg: dict[str, int] = {}
        for e in edges:
            deg[e["source"]] = deg.get(e["source"], 0) + 1
            deg[e["target"]] = deg.get(e["target"], 0) + 1
        for nid, n in nodes.items():
            d = deg.get(nid, 0)
            # base 4, log-scaled so a 50-degree hub is ~3× a 5-degree leaf
            # rather than 10× — keeps small nodes legible.
            n["size"] = round(4 + 6 * (d**0.5) / 8, 2)
            n["degree"] = d

    @app.get("/api/graph")
    def api_graph(
        db: str = Query("codebase"),
        limit: int = Query(300, ge=1, le=20000),
        community: str | None = Query(None),
        type: str | None = Query(None, alias="type"),
        view: str = Query("summary", pattern="^(summary|detail)$"),
    ) -> Any:
        database = _resolve_db(db)
        params: dict[str, Any] = {"limit": limit}

        # Summary mode: ignore community/type filters — the view IS the
        # filter (Files + cross-file structural edges).  Honouring them
        # would silently degrade to "summary of just one community" with
        # no UX signal that's what happened.
        if view == "summary":
            if type is not None or community is not None:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": (
                            "type/community filters are detail-view only; "
                            "switch to ?view=detail to combine them"
                        )
                    },
                )
            cypher = SUMMARY_VIEW_CYPHER
        else:
            where: list[str] = []
            if community is not None:
                where.append("n.community = $community")
                params["community"] = community
            if type:
                if type not in ALLOWED_NODE_LABELS:
                    return JSONResponse(
                        status_code=400,
                        content={"error": f"unknown node label: {type}"},
                    )
                where.append(f"'{type}' IN labels(n)")
            where_clause = ("WHERE " + " AND ".join(where)) if where else ""
            cypher = DETAIL_VIEW_CYPHER_TEMPLATE.format(where_clause=where_clause)

        try:
            records = _run(factory.get(), database, cypher, **params)
        except Exception as exc:
            return JSONResponse(status_code=503, content={"error": str(exc)})

        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        for rec in records:
            for n in rec.get("nodes") or []:
                sn = _node_to_sigma(n)
                nodes[sn["id"]] = sn
            for m in rec.get("others") or []:
                if m is None:
                    continue
                sn = _node_to_sigma(m)
                nodes.setdefault(sn["id"], sn)
            for r in rec.get("rels") or []:
                if r is None:
                    continue
                edges.append(_rel_to_sigma(r))
            # Summary mode returns synthesised edge specs (dicts) instead
            # of real Neo4j relationships so we can stitch IMPORTS-via-Module
            # into a direct File-to-File edge.
            for spec in rec.get("edge_specs") or []:
                if spec is None:
                    continue
                src = spec.get("source")
                tgt = spec.get("target")
                if src is None or tgt is None:
                    continue
                src_id = getattr(src, "element_id", None) or str(getattr(src, "id", ""))
                tgt_id = getattr(tgt, "element_id", None) or str(getattr(tgt, "id", ""))
                edges.append(
                    {
                        "id": f"{src_id}->{tgt_id}/{spec.get('type','REL')}",
                        "source": str(src_id),
                        "target": str(tgt_id),
                        "type": spec.get("type", "REL"),
                        "attributes": {},
                    }
                )

        _annotate_with_degree(nodes, edges)
        return {"nodes": list(nodes.values()), "edges": edges, "view": view}

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------
    @app.get("/api/search")
    def api_search(
        db: str = Query("codebase"),
        q: str = Query(..., min_length=1),
        limit: int = Query(20, ge=1, le=200),
    ) -> Any:
        database = _resolve_db(db)
        cypher = (
            "MATCH (n) "
            "WHERE toLower(coalesce(n.name, n.path, '')) CONTAINS toLower($q) "
            "RETURN n LIMIT $limit"
        )
        try:
            records = _run(factory.get(), database, cypher, q=q, limit=limit)
        except Exception as exc:
            return JSONResponse(status_code=503, content={"error": str(exc)})
        return {"results": [_node_to_sigma(r["n"]) for r in records]}

    # ------------------------------------------------------------------
    # Node neighbors
    # ------------------------------------------------------------------
    @app.get("/api/node/{node_id}/neighbors")
    def api_neighbors(
        node_id: str,
        db: str = Query("codebase"),
        depth: int = Query(1, ge=1, le=3),
    ) -> Any:
        database = _resolve_db(db)
        cypher = (
            "MATCH (n) WHERE elementId(n) = $id OR toString(id(n)) = $id "
            f"OPTIONAL MATCH p = (n)-[*1..{depth}]-(m) "
            "WITH n, collect(DISTINCT m) AS neighbors, collect(DISTINCT relationships(p)) AS rels "
            "RETURN n, neighbors, rels"
        )
        try:
            records = _run(factory.get(), database, cypher, id=node_id)
        except Exception as exc:
            return JSONResponse(status_code=503, content={"error": str(exc)})
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        for rec in records:
            root = rec.get("n")
            if root is not None:
                sn = _node_to_sigma(root)
                nodes[sn["id"]] = sn
            for m in rec.get("neighbors") or []:
                if m is None:
                    continue
                sn = _node_to_sigma(m)
                nodes.setdefault(sn["id"], sn)
            for rel_path in rec.get("rels") or []:
                for r in rel_path or []:
                    if r is None:
                        continue
                    edges.append(_rel_to_sigma(r))
        return {"nodes": list(nodes.values()), "edges": edges}

    # ------------------------------------------------------------------
    # SSE /events
    # ------------------------------------------------------------------
    @app.get("/events")
    async def events(request: Request) -> StreamingResponse:
        async def stream() -> AsyncIterator[bytes]:
            last_sig: str | None = None
            hb = 0
            iterator = _ticker_iter(app.state.ticker, app.state.tick_interval)
            async for _ in iterator:
                if await request.is_disconnected():
                    return
                hb += 1
                # heartbeat every tick
                yield f": heartbeat {hb}\n\n".encode()
                try:
                    sig = _signature(factory)
                except Exception as exc:  # noqa: BLE001
                    msg = json.dumps({"error": str(exc)})
                    yield f"event: error\ndata: {msg}\n\n".encode()
                    continue
                if sig != last_sig:
                    last_sig = sig
                    payload = json.dumps({"signature": sig, "ts": time.time()})
                    yield f"event: graph-updated\ndata: {payload}\n\n".encode()

        headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)

    return app


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


async def _ticker_iter(
    ticker: Callable[[], Iterable[None]] | None,
    interval: float,
) -> AsyncIterator[None]:
    """Yield ``None`` on each tick.

    If ``ticker`` is supplied (test-only), it is invoked and iterated.
    Otherwise we fall back to ``asyncio.sleep(interval)``.
    """
    if ticker is not None:
        gen = ticker()
        for _ in gen:
            yield None
            await asyncio.sleep(0)
        return
    while True:
        await asyncio.sleep(interval)
        yield None


def _signature(factory: DriverFactory) -> str:
    """Return a tiny signature reflecting DB state across both graphs.

    Counts both nodes AND edges so that relationship add/delete (not just
    node churn) invalidates the signature.  Pure property edits are still
    missed — acceptable for a 5-second poll.

    Raises on DB error — the caller is the SSE stream, which catches and
    emits ``event: error`` so the client sees a real failure signal instead
    of a stuck "last-known-good" count.
    """
    parts: list[str] = []
    for alias in ("codebase", "memory"):
        db = os.environ.get(DB_ENV_MAP[alias], DB_DEFAULTS[alias])
        rows = _run(
            factory.get(),
            db,
            "MATCH (n) WITH count(n) AS nc "
            "OPTIONAL MATCH ()-[r]->() "
            "RETURN nc, count(r) AS ec",
        )
        if rows:
            nc = rows[0].get("nc", 0)
            ec = rows[0].get("ec", 0)
        else:
            nc = ec = 0
        parts.append(f"{alias}:{nc}/{ec}")
    return "|".join(parts)


# Default module-level app instance for ``uvicorn daddy_agent.viz.server:app``.
app = create_app()
