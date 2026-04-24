"""Per-language Tree-sitter query strings.

Each submodule exposes four query strings used by :mod:`..parser`:

* ``IMPORTS_QUERY`` — captures ``@import`` modules.
* ``FUNCTIONS_QUERY`` — captures ``@function.def`` and ``@function.name``.
* ``CLASSES_QUERY`` — captures ``@class.def``, ``@class.name`` and, where the
  language supports it, ``@class.extends`` / ``@class.implements``.
* ``CALLS_QUERY`` — captures ``@call`` callee identifiers.

The parser only uses these queries when Tree-sitter's query engine is
available; the fallback parse path walks the AST manually so tests can still
exercise behaviour even if a grammar ships without query support.
"""

from daddy_agent.codebase_graph.queries import (
    go as go,
)
from daddy_agent.codebase_graph.queries import (
    javascript as javascript,
)
from daddy_agent.codebase_graph.queries import (
    python as python,
)
from daddy_agent.codebase_graph.queries import (
    rust as rust,
)
from daddy_agent.codebase_graph.queries import (
    typescript as typescript,
)

__all__ = ["go", "javascript", "python", "rust", "typescript"]
