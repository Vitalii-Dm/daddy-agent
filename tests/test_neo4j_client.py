"""Unit tests for :mod:`daddy_agent.neo4j_client`.

These tests mock out the Neo4j driver entirely; no live database is required.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from daddy_agent import neo4j_client
from daddy_agent.neo4j_client import Neo4jConfig, close_driver, get_driver, session


@pytest.fixture(autouse=True)
def _reset_driver_cache() -> None:
    """Ensure every test starts with a fresh driver cache."""
    get_driver.cache_clear()
    yield
    get_driver.cache_clear()


def test_config_from_env_reads_all_three_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEO4J_URI", "bolt://example:7687")
    monkeypatch.setenv("NEO4J_USER", "alice")
    monkeypatch.setenv("NEO4J_PASSWORD", "s3cret")

    cfg = Neo4jConfig.from_env()

    assert cfg.uri == "bolt://example:7687"
    assert cfg.user == "alice"
    assert cfg.password == "s3cret"


def test_config_from_env_defaults_uri_and_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEO4J_URI", raising=False)
    monkeypatch.delenv("NEO4J_USER", raising=False)
    monkeypatch.setenv("NEO4J_PASSWORD", "pw")

    cfg = Neo4jConfig.from_env()

    assert cfg.uri == "bolt://localhost:7687"
    assert cfg.user == "neo4j"
    assert cfg.password == "pw"


def test_config_from_env_rejects_missing_password(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEO4J_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="NEO4J_PASSWORD"):
        Neo4jConfig.from_env()


def test_session_closes_session_but_not_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "pw")

    fake_session = MagicMock(name="session")
    fake_driver = MagicMock(name="driver")
    fake_driver.session.return_value = fake_session

    with patch.object(neo4j_client.GraphDatabase, "driver", return_value=fake_driver) as ctor:
        with session("codebase") as sess:
            assert sess is fake_session

        ctor.assert_called_once_with("bolt://localhost:7687", auth=("neo4j", "pw"))
        fake_driver.session.assert_called_once_with(database="codebase")
        fake_session.close.assert_called_once()
        fake_driver.close.assert_not_called()


def test_get_driver_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEO4J_PASSWORD", "pw")
    fake_driver = MagicMock(name="driver")

    with patch.object(neo4j_client.GraphDatabase, "driver", return_value=fake_driver) as ctor:
        a = get_driver()
        b = get_driver()

    assert a is b
    assert ctor.call_count == 1


def test_close_driver_tears_down_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEO4J_PASSWORD", "pw")
    fake_driver = MagicMock(name="driver")

    with patch.object(neo4j_client.GraphDatabase, "driver", return_value=fake_driver):
        get_driver()
        close_driver()
        fake_driver.close.assert_called_once()
        assert get_driver.cache_info().currsize == 0
