"""Thin Neo4j connection helper used by every daddy-agent component.

Reads ``NEO4J_URI``, ``NEO4J_USER`` and ``NEO4J_PASSWORD`` from the environment.
Exposes a cached :func:`get_driver` and a :func:`session` context manager that
closes the session (not the driver) on exit.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from neo4j import Driver, GraphDatabase, Session

__all__ = ["Neo4jConfig", "get_driver", "session", "close_driver"]


class Neo4jConfig:
    """Container for Neo4j connection parameters resolved from the environment."""

    __slots__ = ("uri", "user", "password")

    def __init__(self, uri: str, user: str, password: str) -> None:
        self.uri = uri
        self.user = user
        self.password = password

    @classmethod
    def from_env(cls) -> Neo4jConfig:
        uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
        user = os.environ.get("NEO4J_USER", "neo4j")
        password = os.environ.get("NEO4J_PASSWORD")
        if not password:
            raise RuntimeError(
                "NEO4J_PASSWORD env var must be set to connect to Neo4j."
            )
        return cls(uri=uri, user=user, password=password)


@lru_cache(maxsize=1)
def get_driver() -> Driver:
    """Return a process-wide cached Neo4j driver built from env vars.

    The driver is thread-safe and intended to live for the process lifetime.
    Call :func:`close_driver` to tear it down (mostly useful in tests).
    """
    cfg = Neo4jConfig.from_env()
    return GraphDatabase.driver(cfg.uri, auth=(cfg.user, cfg.password))


def close_driver() -> None:
    """Close and drop the cached driver. Safe to call even if never opened."""
    driver_cache = get_driver.cache_info()
    if driver_cache.currsize == 0:
        return
    driver = get_driver()
    driver.close()
    get_driver.cache_clear()


@contextmanager
def session(database: str) -> Iterator[Session]:
    """Yield a Neo4j session bound to ``database``; always closes on exit."""
    driver = get_driver()
    sess = driver.session(database=database)
    try:
        yield sess
    finally:
        sess.close()
