"""FastMCP server exposing codebase-graph tools.

The server is the only module that talks to Neo4j.  Every MCP tool maps
to exactly one query in :mod:`daddy_agent.codebase_mcp.queries`, so the
orchestration logic here stays thin and trivially testable.

We keep the implementation synchronous: Neo4j's Python driver exposes a
sync API, and FastMCP's ``@tool`` decorator handles both sync and async
handlers.  Tests invoke the handler functions directly, which means the
MCP SDK is only touched at import time and at ``serve()`` time.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel, Field, field_validator

from daddy_agent.codebase_mcp import queries
from daddy_agent.codebase_mcp.safety import ReadOnlyViolation, ensure_read_only

if TYPE_CHECKING:  # pragma: no cover - only used for typing
    from neo4j import Driver


# --------------------------------------------------------------------------- #
# Pydantic input models
# --------------------------------------------------------------------------- #


class SearchCodeInput(BaseModel):
    """Inputs for :func:`search_code`."""

    query: str = Field(..., min_length=1, description="Free text to look for")
    limit: int = Field(20, ge=1, le=200, description="Max hits to return")


class NameLookupInput(BaseModel):
    """Inputs for :func:`get_callers` / :func:`get_callees`."""

    name: str = Field(..., min_length=1)
    file_path: str | None = Field(None, description="Disambiguate by file")


class DependenciesInput(BaseModel):
    """Inputs for :func:`get_dependencies`."""

    file_path: str = Field(..., min_length=1)
    depth: int = Field(1, ge=1, le=10)


class CommunityInput(BaseModel):
    """Inputs for :func:`get_community`."""

    name: str = Field(..., min_length=1)


class ImpactAnalysisInput(BaseModel):
    """Inputs for :func:`impact_analysis`."""

    file_path: str = Field(..., min_length=1)


class FindDeadCodeInput(BaseModel):
    """Inputs for :func:`find_dead_code`."""

    limit: int = Field(500, ge=1, le=5000)


class RunCypherInput(BaseModel):
    """Inputs for :func:`run_cypher`."""

    query: str = Field(..., min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)

    @field_validator("params")
    @classmethod
    def _ensure_serializable_keys(cls, v: dict[str, Any]) -> dict[str, Any]:
        for key in v:
            if not isinstance(key, str):
                raise ValueError("params keys must be strings")
        return v


# --------------------------------------------------------------------------- #
# Row output models
# --------------------------------------------------------------------------- #


class CodeHit(BaseModel):
    """A single hit from :func:`search_code`."""

    kind: str
    name: str
    path: str | None = None
    line: int = 0
    docstring: str = ""


class FunctionRef(BaseModel):
    """Reference to a Function node."""

    name: str
    file_path: str | None = None
    line: int = 0
    signature: str = ""


class DependencyHit(BaseModel):
    """A single row from :func:`get_dependencies`."""

    kind: str
    name: str
    depth: int


class CommunityInfo(BaseModel):
    """Community membership of a node."""

    kind: str
    name: str
    community_id: Any | None = None
    community_label: str | None = None
    community_description: str | None = None


class ImpactRow(BaseModel):
    """A single row in the grouped impact report."""

    kind: str
    name: str
    file_path: str | None = None


class ImpactReport(BaseModel):
    """Grouped impact-analysis output."""

    files: list[ImpactRow] = Field(default_factory=list)
    functions: list[ImpactRow] = Field(default_factory=list)
    node_cap: int = 200
    truncated: bool = False


class DeadCodeHit(BaseModel):
    """Possible dead-code symbol."""

    name: str
    file_path: str | None = None
    line: int = 0
    signature: str = ""


class CypherRow(BaseModel):
    """A single row returned by :func:`run_cypher`."""

    data: dict[str, Any]


class CypherResult(BaseModel):
    """Envelope returned by :func:`run_cypher`."""

    rows: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    row_cap: int = 500


# --------------------------------------------------------------------------- #
# Session protocol + driver wrapper
# --------------------------------------------------------------------------- #


class _RecordLike(Protocol):
    """Minimal slice of the neo4j.Record interface we depend on."""

    def data(self) -> dict[str, Any]: ...  # pragma: no cover - Protocol


class _SessionLike(Protocol):
    """Minimal slice of the neo4j.Session interface we depend on."""

    def run(
        self, query: str, parameters: dict[str, Any] | None = ..., **kwargs: Any
    ) -> Iterable[_RecordLike]: ...  # pragma: no cover - Protocol

    def close(self) -> None: ...  # pragma: no cover - Protocol


@dataclass
class CodebaseGraph:
    """Thin wrapper around a Neo4j ``Driver``.

    The class is deliberately tiny: it opens a session on the codebase
    database, runs a query and returns plain ``dict`` rows.  All heavy
    lifting is delegated to :mod:`daddy_agent.codebase_mcp.queries`.
    """

    driver: Any  # neo4j.Driver — untyped at runtime to keep tests light
    database: str = "codebase"
    row_cap: int = 500

    # Injection point used by tests.  Production code leaves this at None
    # and we fall back to ``driver.session(database=...)``.
    _session_factory: Any = field(default=None, repr=False)

    def _session(self) -> _SessionLike:
        if self._session_factory is not None:
            return self._session_factory(database=self.database)
        return self.driver.session(database=self.database)

    # ------------------------------------------------------------------ #
    # Query helpers
    # ------------------------------------------------------------------ #

    def _fetch(
        self,
        query: str,
        params: dict[str, Any] | None = None,
        *,
        row_cap: int | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        """Run *query*, return ``(rows, truncated)``."""
        cap = row_cap if row_cap is not None else self.row_cap
        session = self._session()
        try:
            result = session.run(query, parameters=params or {})
            rows: list[dict[str, Any]] = []
            truncated = False
            for record in result:
                if len(rows) >= cap:
                    truncated = True
                    break
                rows.append(dict(record.data()))
            return rows, truncated
        finally:
            try:
                session.close()
            except Exception:  # pragma: no cover - defensive
                pass

    # ------------------------------------------------------------------ #
    # Tool implementations
    # ------------------------------------------------------------------ #

    def search_code(self, inp: SearchCodeInput) -> list[CodeHit]:
        rows, _ = self._fetch(
            queries.SEARCH_CODE,
            {"query": inp.query, "limit": inp.limit},
            row_cap=inp.limit,
        )
        return [CodeHit(**row) for row in rows]

    def get_callers(self, inp: NameLookupInput) -> list[FunctionRef]:
        rows, _ = self._fetch(
            queries.GET_CALLERS,
            {"name": inp.name, "file_path": inp.file_path},
        )
        return [FunctionRef(**row) for row in rows]

    def get_callees(self, inp: NameLookupInput) -> list[FunctionRef]:
        rows, _ = self._fetch(
            queries.GET_CALLEES,
            {"name": inp.name, "file_path": inp.file_path},
        )
        return [FunctionRef(**row) for row in rows]

    def get_dependencies(self, inp: DependenciesInput) -> list[DependencyHit]:
        rendered = queries.render_dependencies_query(inp.depth)
        rows, _ = self._fetch(rendered, {"file_path": inp.file_path})
        return [DependencyHit(**row) for row in rows]

    def get_community(self, inp: CommunityInput) -> CommunityInfo | None:
        rows, _ = self._fetch(queries.GET_COMMUNITY, {"name": inp.name})
        if not rows:
            return None
        return CommunityInfo(**rows[0])

    def impact_analysis(self, inp: ImpactAnalysisInput) -> ImpactReport:
        node_cap = 200
        rows, truncated = self._fetch(
            queries.IMPACT_ANALYSIS,
            {"file_path": inp.file_path, "node_cap": node_cap},
            row_cap=node_cap,
        )
        files: list[ImpactRow] = []
        functions: list[ImpactRow] = []
        for row in rows:
            impact_row = ImpactRow(**row)
            if impact_row.kind == "File":
                files.append(impact_row)
            else:
                functions.append(impact_row)
        return ImpactReport(
            files=files,
            functions=functions,
            node_cap=node_cap,
            truncated=truncated,
        )

    def find_dead_code(
        self, inp: FindDeadCodeInput | None = None
    ) -> list[DeadCodeHit]:
        limit = (inp or FindDeadCodeInput()).limit
        rows, _ = self._fetch(
            queries.FIND_DEAD_CODE, {"limit": limit}, row_cap=limit
        )
        return [DeadCodeHit(**row) for row in rows]

    def run_cypher(self, inp: RunCypherInput) -> CypherResult:
        try:
            ensure_read_only(inp.query)
        except ReadOnlyViolation as exc:
            # Re-raise with a typed message FastMCP can surface.
            raise ReadOnlyViolation(f"read-only guard: {exc}") from exc

        rows, truncated = self._fetch(
            inp.query, inp.params, row_cap=self.row_cap
        )
        return CypherResult(
            rows=rows,
            row_count=len(rows),
            truncated=truncated,
            row_cap=self.row_cap,
        )


# --------------------------------------------------------------------------- #
# FastMCP wiring
# --------------------------------------------------------------------------- #


def build_mcp(graph: CodebaseGraph) -> Any:
    """Build and return a :class:`mcp.server.fastmcp.FastMCP` instance.

    Import of the ``mcp`` SDK is deferred so the rest of the module is
    importable in environments that only care about the query layer
    (e.g. unit tests).  The SDK is a declared runtime dependency.
    """
    from mcp.server.fastmcp import FastMCP  # type: ignore[import-not-found]

    mcp = FastMCP("codebase-graph")

    @mcp.tool()
    def search_code(query: str, limit: int = 20) -> list[dict[str, Any]]:
        """Full-text search across File/Function/Class names + docstrings."""
        hits = graph.search_code(SearchCodeInput(query=query, limit=limit))
        return [h.model_dump() for h in hits]

    @mcp.tool()
    def get_callers(
        name: str, file_path: str | None = None
    ) -> list[dict[str, Any]]:
        """Functions that CALL the named function."""
        refs = graph.get_callers(
            NameLookupInput(name=name, file_path=file_path)
        )
        return [r.model_dump() for r in refs]

    @mcp.tool()
    def get_callees(
        name: str, file_path: str | None = None
    ) -> list[dict[str, Any]]:
        """Functions called by the named function."""
        refs = graph.get_callees(
            NameLookupInput(name=name, file_path=file_path)
        )
        return [r.model_dump() for r in refs]

    @mcp.tool()
    def get_dependencies(
        file_path: str, depth: int = 1
    ) -> list[dict[str, Any]]:
        """IMPORTS chain up to ``depth`` hops from ``file_path``."""
        hits = graph.get_dependencies(
            DependenciesInput(file_path=file_path, depth=depth)
        )
        return [h.model_dump() for h in hits]

    @mcp.tool()
    def get_community(name: str) -> dict[str, Any] | None:
        """Community label for the named node."""
        info = graph.get_community(CommunityInput(name=name))
        return info.model_dump() if info else None

    @mcp.tool()
    def impact_analysis(file_path: str) -> dict[str, Any]:
        """BFS over callers and importers, capped at 200 nodes."""
        return graph.impact_analysis(
            ImpactAnalysisInput(file_path=file_path)
        ).model_dump()

    @mcp.tool()
    def find_dead_code(limit: int = 500) -> list[dict[str, Any]]:
        """Functions with no incoming CALLS edges and not marked exported."""
        hits = graph.find_dead_code(FindDeadCodeInput(limit=limit))
        return [h.model_dump() for h in hits]

    @mcp.tool()
    def run_cypher(
        query: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Read-only raw Cypher, capped at 500 rows."""
        result = graph.run_cypher(
            RunCypherInput(query=query, params=params or {})
        )
        return result.model_dump()

    return mcp


# --------------------------------------------------------------------------- #
# Bootstrap from environment
# --------------------------------------------------------------------------- #


@dataclass
class ServerConfig:
    """Subset of environment variables the server cares about."""

    uri: str
    user: str
    password: str
    database: str

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> ServerConfig:
        src = env if env is not None else os.environ
        return cls(
            uri=src.get("NEO4J_URI", "bolt://localhost:7687"),
            user=src.get("NEO4J_USER", "neo4j"),
            password=src.get("NEO4J_PASSWORD", "neo4j"),
            database=src.get("NEO4J_CODEBASE_DB", "codebase"),
        )


def build_graph_from_env(env: dict[str, str] | None = None) -> CodebaseGraph:
    """Create a :class:`CodebaseGraph` configured from environment vars."""
    from neo4j import GraphDatabase  # type: ignore[import-not-found]

    cfg = ServerConfig.from_env(env)
    driver: Driver = GraphDatabase.driver(
        cfg.uri, auth=(cfg.user, cfg.password)
    )
    return CodebaseGraph(driver=driver, database=cfg.database)


def serve() -> None:
    """Entry-point used by ``python -m daddy_agent.codebase_mcp``."""
    graph = build_graph_from_env()
    mcp = build_mcp(graph)
    mcp.run()


__all__ = [
    "CodebaseGraph",
    "CodeHit",
    "CommunityInfo",
    "CommunityInput",
    "CypherResult",
    "DeadCodeHit",
    "DependenciesInput",
    "DependencyHit",
    "FindDeadCodeInput",
    "FunctionRef",
    "ImpactAnalysisInput",
    "ImpactReport",
    "ImpactRow",
    "NameLookupInput",
    "RunCypherInput",
    "SearchCodeInput",
    "ServerConfig",
    "build_graph_from_env",
    "build_mcp",
    "serve",
]
