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
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Dict, Iterable, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Neo4j driver lifecycle
# ---------------------------------------------------------------------------

# Mapping of logical DB name -> env variable that overrides the database name.
DB_ENV_MAP: Dict[str, str] = {
    "codebase": "NEO4J_CODEBASE_DB",
    "memory": "NEO4J_MEMORY_DB",
}
DB_DEFAULTS: Dict[str, str] = {
    "codebase": "codebase",
    "memory": "agent_memory",
}


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
        self._last_error: Optional[str] = None

    def _create_driver(self) -> Any:
        from neo4j import GraphDatabase  # imported lazily for test-friendliness

        uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
        user = os.environ.get("NEO4J_USER", "neo4j")
        pwd = os.environ.get("NEO4J_PASSWORD", "neo4j")
        return GraphDatabase.driver(uri, auth=(user, pwd))

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


def _node_to_sigma(node: Any) -> Dict[str, Any]:
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


def _rel_to_sigma(rel: Any) -> Dict[str, Any]:
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


def _run(driver: Any, db: str, cypher: str, **params: Any) -> List[Dict[str, Any]]:
    """Execute a Cypher query and return the records as dicts.

    ``db`` is the *resolved* database name (not the ``codebase``/``memory``
    alias) so the caller has already mapped it.
    """
    session_kwargs: Dict[str, Any] = {"database": db} if db else {}
    with driver.session(**session_kwargs) as session:
        result = session.run(cypher, **params)
        return [dict(record) for record in result]


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(
    driver_factory: Optional[DriverFactory] = None,
    *,
    tick_interval: float = 5.0,
    ticker: Optional[Callable[[], Iterable[None]]] = None,
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
    @app.get("/api/graph")
    def api_graph(
        db: str = Query("codebase"),
        limit: int = Query(1000, ge=1, le=20000),
        community: Optional[str] = Query(None),
        type: Optional[str] = Query(None, alias="type"),
    ) -> Any:
        database = _resolve_db(db)
        where: List[str] = []
        params: Dict[str, Any] = {"limit": limit}
        if community is not None:
            where.append("n.community = $community")
            params["community"] = community
        if type:
            # Label filter (cannot parametrise labels in Cypher, so we
            # whitelist characters to avoid injection).
            safe = "".join(c for c in type if c.isalnum() or c == "_")
            if safe:
                where.append(f"'{safe}' IN labels(n)")
        where_clause = ("WHERE " + " AND ".join(where)) if where else ""
        cypher = (
            f"MATCH (n) {where_clause} "
            "WITH n LIMIT $limit "
            "OPTIONAL MATCH (n)-[r]->(m) "
            "RETURN collect(DISTINCT n) AS nodes, collect(DISTINCT r) AS rels, "
            "       collect(DISTINCT m) AS others"
        )
        try:
            records = _run(factory.get(), database, cypher, **params)
        except Exception as exc:
            return JSONResponse(status_code=503, content={"error": str(exc)})

        nodes: Dict[str, Dict[str, Any]] = {}
        edges: List[Dict[str, Any]] = []
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
        return {"nodes": list(nodes.values()), "edges": edges}

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
        nodes: Dict[str, Dict[str, Any]] = {}
        edges: List[Dict[str, Any]] = []
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
            last_sig: Optional[str] = None
            hb = 0
            iterator = _ticker_iter(app.state.ticker, app.state.tick_interval)
            async for _ in iterator:
                if await request.is_disconnected():
                    return
                hb += 1
                # heartbeat every tick
                yield f": heartbeat {hb}\n\n".encode("utf-8")
                try:
                    sig = _signature(factory)
                except Exception as exc:  # noqa: BLE001
                    msg = json.dumps({"error": str(exc)})
                    yield f"event: error\ndata: {msg}\n\n".encode("utf-8")
                    continue
                if sig != last_sig:
                    last_sig = sig
                    payload = json.dumps({"signature": sig, "ts": time.time()})
                    yield f"event: graph-updated\ndata: {payload}\n\n".encode("utf-8")

        headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)

    return app


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


async def _ticker_iter(
    ticker: Optional[Callable[[], Iterable[None]]],
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
    """Return a tiny signature reflecting DB state across both graphs."""
    parts: List[str] = []
    for alias in ("codebase", "memory"):
        db = os.environ.get(DB_ENV_MAP[alias], DB_DEFAULTS[alias])
        try:
            rows = _run(factory.get(), db, "MATCH (n) RETURN count(n) AS c")
            c = rows[0]["c"] if rows else 0
        except Exception:
            c = -1
        parts.append(f"{alias}:{c}")
    return "|".join(parts)


# Default module-level app instance for ``uvicorn daddy_agent.viz.server:app``.
app = create_app()
