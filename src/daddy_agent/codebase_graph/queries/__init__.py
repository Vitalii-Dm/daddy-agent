"""Per-language Tree-sitter AST-node-type constants.

Each submodule exposes the node-kind strings that :mod:`..parser`'s walker
looks for — e.g. ``FUNCTION_NODE``/``FUNCTION_NODES``, ``CLASS_NODE``,
``IMPORT_NODE(S)``, ``CALL_NODE``.  The parser walks the syntax tree
manually (rather than using tree-sitter's query DSL) because some
``tree-sitter-language-pack`` builds ship without the query engine.
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
