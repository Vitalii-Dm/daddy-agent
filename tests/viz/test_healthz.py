"""Healthz endpoint tests.

Verifies 200 when the driver reports connectivity and 503 with a reason
when it does not.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_healthz_ok(fake_driver_factory):
    factory = fake_driver_factory(lambda c, p: [])
    from daddy_agent.viz.server import create_app

    app = create_app(factory)
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_healthz_unavailable():
    from daddy_agent.viz.server import DriverFactory, create_app

    class BrokenDriver:
        def verify_connectivity(self) -> None:
            raise RuntimeError("no route to host")

        def close(self) -> None:
            pass

        def session(self, **kwargs):  # pragma: no cover - not called on /healthz
            raise RuntimeError("not used")

    factory = DriverFactory()
    factory._driver = BrokenDriver()  # type: ignore[attr-defined]
    app = create_app(factory)
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "unavailable"
    assert "no route to host" in body["reason"]


def test_healthz_driver_creation_fails(monkeypatch):
    """If creating the driver itself fails, /healthz stays graceful."""
    from daddy_agent.viz.server import DriverFactory, create_app

    factory = DriverFactory()

    def boom(self):
        raise RuntimeError("bolt://?? unreachable")

    monkeypatch.setattr(DriverFactory, "_create_driver", boom)
    app = create_app(factory)
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 503
    assert "unreachable" in r.json()["reason"]
