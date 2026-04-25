#!/usr/bin/env python3
"""Regenerate SRI hashes for the CDN <script> tags in the viz dashboard.

Fetches each pinned CDN URL, computes its sha384 SRI hash, and rewrites
the matching ``integrity="..."`` attribute in
``src/daddy_agent/viz/static/index.html``.  Removes the
``REQUIRES_SRI_REGEN`` marker once every hash is real.
"""

from __future__ import annotations

import base64
import hashlib
import pathlib
import re
import ssl
import sys
import urllib.error
import urllib.request


def _ssl_context() -> ssl.SSLContext:
    """Build an SSL context with a usable CA bundle.

    macOS' system Python often ships without trusted roots loaded, so the
    default context fails with ``CERTIFICATE_VERIFY_FAILED``.  Prefer
    ``certifi`` if available — it is a transitive dep of urllib3, fastapi's
    test deps, and most HTTP libs the project already uses.
    """
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover - rare
        return ssl.create_default_context()

INDEX = pathlib.Path("src/daddy_agent/viz/static/index.html")

URLS: list[tuple[str, str]] = [
    (
        "graphology",
        "https://cdn.jsdelivr.net/npm/graphology@0.25.4/dist/graphology.umd.min.js",
    ),
    (
        # Bundles forceatlas2 + assorted layout/community algorithms; the
        # standalone graphology-layout-forceatlas2 npm package ships only
        # CommonJS source with no browser build.  The JS in index.html
        # already accepts ``window.graphologyLibrary.layoutForceAtlas2``.
        "graphology-library",
        "https://cdn.jsdelivr.net/npm/graphology-library@0.7.0/dist/graphology-library.min.js",
    ),
    (
        "sigma",
        "https://cdn.jsdelivr.net/npm/sigma@3.0.1/dist/sigma.min.js",
    ),
]


def fetch(url: str, timeout: float = 30.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "daddy-agent-sri"})
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        return resp.read()


def sri_for(content: bytes) -> str:
    digest = hashlib.sha384(content).digest()
    return "sha384-" + base64.b64encode(digest).decode("ascii")


def replace(html: str, url: str, sri: str) -> tuple[str, int]:
    pattern = re.compile(
        r'(src="' + re.escape(url) + r'"\s*\n\s*integrity=")[^"]+"',
        re.MULTILINE,
    )
    return pattern.subn(lambda m: m.group(1) + sri + '"', html)


def main() -> int:
    if not INDEX.exists():
        sys.stderr.write(f"missing {INDEX}\n")
        return 2
    html = INDEX.read_text()
    for name, url in URLS:
        try:
            body = fetch(url)
        except urllib.error.URLError as exc:
            sys.stderr.write(f"fetch failed for {url}: {exc}\n")
            return 1
        sri = sri_for(body)
        html, n = replace(html, url, sri)
        if n == 0:
            sys.stderr.write(f"no integrity= line matched {url}\n")
            return 1
        print(f"  {name:<12} {sri}")

    if "PLACEHOLDER-REGENERATE-BEFORE-DEPLOY" in html:
        sys.stderr.write(
            "WARNING: some PLACEHOLDER-REGENERATE-BEFORE-DEPLOY markers "
            "remain — inspect the file before deploying.\n"
        )
        INDEX.write_text(html)
        return 1

    # Strip the regen marker line once all hashes are real.
    html = re.sub(r"^\s*<!-- REQUIRES_SRI_REGEN -->\n", "", html, flags=re.MULTILINE)
    INDEX.write_text(html)
    print("SRI hashes updated; REQUIRES_SRI_REGEN marker removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
