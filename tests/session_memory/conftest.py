"""Pytest configuration for session_memory tests.

Ensures ``src/`` is on ``sys.path`` so the tests run from a plain
``pytest`` invocation without requiring an editable install.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[2] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
