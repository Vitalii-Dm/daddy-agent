"""Repository indexer.

Walks a repository honouring ``.gitignore`` (via :mod:`pathspec`), hashes each
file with sha256, reads previously-ingested hashes from Neo4j, and only
re-parses files whose hash changed.  Full-index mode ignores the hash check
and re-ingests everything.

Exposes a console-script style :func:`main` so ``daddy-index`` can be wired up
in ``pyproject.toml``.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from daddy_agent.codebase_graph.ingester import ingest_file
from daddy_agent.codebase_graph.parser import (
    LANGUAGE_BY_SUFFIX,
    ParsedFile,
    parse_source,
    sha256_bytes,
)
from daddy_agent.codebase_graph.schema import apply_schema

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@dataclass
class IndexResult:
    """Summary of a single indexing run."""

    indexed: list[str]
    skipped: list[str]
    removed: list[str]

    @property
    def changed(self) -> int:
        return len(self.indexed) + len(self.removed)


# ---------------------------------------------------------------------------
# Gitignore handling
# ---------------------------------------------------------------------------

DEFAULT_IGNORES = (
    ".git/",
    ".hg/",
    ".svn/",
    "__pycache__/",
    ".venv/",
    "venv/",
    "node_modules/",
    "dist/",
    "build/",
    ".mypy_cache/",
    ".pytest_cache/",
    ".ruff_cache/",
    "*.pyc",
)


def _load_pathspec(root: Path) -> Any:
    """Return a :class:`pathspec.PathSpec` combining defaults + ``.gitignore``.

    Imported lazily to keep the module importable in environments where
    pathspec isn't installed (e.g. minimal CI).
    """

    try:
        import pathspec  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover - env-dependent
        return None

    patterns = list(DEFAULT_IGNORES)
    gitignore = root / ".gitignore"
    if gitignore.is_file():
        patterns.extend(gitignore.read_text("utf-8").splitlines())
    return pathspec.PathSpec.from_lines("gitwildmatch", patterns)


def _iter_source_files(root: Path, spec: Any) -> Iterator[Path]:
    root = root.resolve()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        rel_str = rel.as_posix()
        if spec is not None and spec.match_file(rel_str):
            continue
        if path.suffix.lower() not in LANGUAGE_BY_SUFFIX:
            continue
        yield path


# ---------------------------------------------------------------------------
# Hash lookup
# ---------------------------------------------------------------------------


def _known_hashes(session: Any, project_root: str) -> dict[str, str]:
    """Query Neo4j for ``(File.path, File.hash)`` tuples in this project."""

    if session is None:
        return {}
    run = getattr(session, "run", None)
    if not callable(run):
        return {}
    try:
        result = run(
            "MATCH (f:File {project_root: $project_root}) "
            "RETURN f.path AS path, f.hash AS hash",
            project_root=project_root,
        )
    except Exception as exc:  # pragma: no cover - depends on driver
        log.warning("could not load existing hashes: %s", exc)
        return {}

    # Support neo4j Result, list[dict], or list[tuple]
    hashes: dict[str, str] = {}
    try:
        for record in result:
            if isinstance(record, dict):
                path = record.get("path")
                h = record.get("hash")
            else:
                path = record[0] if len(record) > 0 else None
                h = record[1] if len(record) > 1 else None
            if path and h:
                hashes[path] = h
    except Exception as exc:  # pragma: no cover
        log.warning("could not iterate hash result: %s", exc)
    return hashes


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def index_repository(
    root: Path | str,
    *,
    full: bool = False,
    session: Any | None = None,
    apply_schema_on_start: bool = True,
    project_root: str | None = None,
) -> IndexResult:
    """Walk ``root`` and ingest changed files under ``project_root``.

    ``project_root`` defaults to the absolute path of ``root`` and is
    written onto every ingested node, scoping the data to this repo so
    multiple projects can cohabit a single Neo4j instance.

    If ``session`` is ``None`` we connect to Neo4j using env vars, so tests can
    pass a fake/mock session directly.
    """

    root_path = Path(root).resolve()
    if not root_path.is_dir():
        raise NotADirectoryError(root_path)
    resolved_project_root = project_root or str(root_path)

    owned_session = session is None
    if owned_session:
        session = _connect_from_env()

    try:
        if apply_schema_on_start and session is not None:
            # apply_schema failures must be fatal: indexing without the
            # uniqueness constraints will let the first duplicate MERGE
            # corrupt the graph silently.  Better to refuse to run.
            apply_schema(session)

        spec = _load_pathspec(root_path)
        existing = {} if full else _known_hashes(session, resolved_project_root)

        indexed: list[str] = []
        skipped: list[str] = []
        seen: set[str] = set()

        for abs_path in _iter_source_files(root_path, spec):
            rel = abs_path.relative_to(root_path).as_posix()
            seen.add(rel)
            try:
                data = abs_path.read_bytes()
            except OSError as exc:
                log.warning("could not read %s: %s", abs_path, exc)
                continue
            new_hash = sha256_bytes(data)
            if not full and existing.get(rel) == new_hash:
                skipped.append(rel)
                continue
            parsed = parse_source(rel, data)
            # parse_source recomputes the hash from source; override with the
            # authoritative repo-relative sha for consistency.
            parsed = ParsedFile(
                path=rel,
                language=parsed.language,
                hash=new_hash,
                functions=parsed.functions,
                classes=parsed.classes,
                imports=parsed.imports,
            )
            ingest_file(session, parsed, project_root=resolved_project_root)
            indexed.append(rel)

        # Remove files that disappeared from disk (scoped to this project).
        removed = [p for p in existing if p not in seen]
        for path in removed:
            _remove_file(session, path, resolved_project_root)

        return IndexResult(indexed=indexed, skipped=skipped, removed=removed)
    finally:
        if owned_session and session is not None:
            close = getattr(session, "close", None)
            if callable(close):
                try:
                    close()
                except Exception as exc:  # pragma: no cover
                    # Don't re-raise during cleanup, but don't be silent
                    # either — pool-exhaustion / auth-expiry bugs start as
                    # close-time errors.
                    log.warning("neo4j session close failed: %s", exc)


def _remove_file(session: Any, path: str, project_root: str) -> None:
    run = getattr(session, "run", None)
    if not callable(run):
        return
    run(
        """
        MATCH (f:File {path: $path, project_root: $project_root})
        OPTIONAL MATCH (f)-[:HAS_FUNCTION]->(fn:Function)
        OPTIONAL MATCH (f)-[:HAS_CLASS]->(c:Class)
        OPTIONAL MATCH (c)-[:HAS_METHOD]->(m:Method)
        DETACH DELETE f, fn, c, m
        """,
        path=path,
        project_root=project_root,
    )


def _connect_from_env() -> Any:  # pragma: no cover - real driver required
    import os

    from neo4j import GraphDatabase  # type: ignore[import-not-found]

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "neo4j")
    # Prefer NEO4J_CODEBASE_DB (the project-wide canonical name used by
    # docker-compose, the viz server, and .env.example); fall back to
    # NEO4J_DATABASE for back-compat with users who set the generic var.
    database = os.environ.get(
        "NEO4J_CODEBASE_DB",
        os.environ.get("NEO4J_DATABASE", "codebase"),
    )

    driver = GraphDatabase.driver(uri, auth=(user, password))
    return driver.session(database=database)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Iterable[str] | None = None) -> int:
    """``daddy-index`` entry point."""

    parser = argparse.ArgumentParser(prog="daddy-index", description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="repository root")
    parser.add_argument("--full", action="store_true", help="re-index everything")
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="incremental mode (default); kept for CLI ergonomics",
    )
    parser.add_argument(
        "--project-root",
        default=None,
        help=(
            "Project namespace tag written onto every node so multiple repos "
            "can cohabit a single Neo4j DB. Defaults to the absolute path of "
            "<root>."
        ),
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    try:
        result = index_repository(
            args.root, full=args.full, project_root=args.project_root
        )
    except Exception as exc:  # pragma: no cover - depends on env
        log.error("indexing failed: %s", exc)
        return 1

    log.info(
        "indexed=%d skipped=%d removed=%d",
        len(result.indexed),
        len(result.skipped),
        len(result.removed),
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
