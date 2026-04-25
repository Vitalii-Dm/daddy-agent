"""Test configuration: add ``src/`` to ``sys.path`` so ``daddy_agent`` is importable.

Worker 2 ships without a ``pyproject.toml``; other workers (W1 infra) are
expected to add one at merge time.  Until then, tests rely on this sys.path
shim.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC = REPO_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
