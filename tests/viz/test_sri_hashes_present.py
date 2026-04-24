"""Guard test: the dashboard must ship with real SRI hashes, not placeholders.

SRI on every CDN `<script>` is our supply-chain mitigation for the dashboard.
A placeholder hash means scripts/compute-sri-hashes.sh was skipped — we make
that a loud test failure rather than a silent runtime one.  Run the script
before merging / deploying; it rewrites the placeholders with real hashes.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

INDEX_HTML = Path(__file__).resolve().parents[2] / "src/daddy_agent/viz/static/index.html"


def _require_real_sri() -> bool:
    """Pre-deploy / CI opts in; local dev is not blocked by placeholders.

    Rationale: this guard exists to stop a placeholder SRI from shipping to
    shared environments.  Forcing every local `pytest` run to first execute
    scripts/compute-sri-hashes.sh (which needs network + curl) would be
    hostile to offline dev.  CI pipelines and pre-deploy checks set
    DADDY_REQUIRE_REAL_SRI=1 to enforce it; merge CI should do the same.
    """
    return os.environ.get("DADDY_REQUIRE_REAL_SRI") == "1"


@pytest.mark.skipif(not _require_real_sri(), reason="DADDY_REQUIRE_REAL_SRI not set")
def test_no_placeholder_sri() -> None:
    body = INDEX_HTML.read_text()
    assert "PLACEHOLDER-REGENERATE-BEFORE-DEPLOY" not in body, (
        "Run scripts/compute-sri-hashes.sh to populate real SRI hashes before "
        "merging. Set DADDY_ALLOW_SRI_PLACEHOLDERS=1 to skip during local dev."
    )
    assert "REQUIRES_SRI_REGEN" not in body, (
        "scripts/compute-sri-hashes.sh removes the REQUIRES_SRI_REGEN marker "
        "once all hashes are populated; run it."
    )


def test_every_cdn_script_has_integrity() -> None:
    """Regardless of placeholder status, every CDN <script> must carry integrity."""
    body = INDEX_HTML.read_text()
    for url_fragment in (
        "graphology.umd.min.js",
        "graphology-layout-forceatlas2.min.js",
        "sigma.min.js",
    ):
        idx = body.find(url_fragment)
        assert idx != -1, f"missing script for {url_fragment}"
        # The integrity attribute appears within 200 chars after the src= line.
        window = body[idx : idx + 400]
        assert 'integrity="sha384-' in window, (
            f"script tag for {url_fragment} missing integrity attribute"
        )
        assert 'crossorigin="anonymous"' in window, (
            f"script tag for {url_fragment} missing crossorigin attribute"
        )
