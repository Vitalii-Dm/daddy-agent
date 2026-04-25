"""Tree-sitter node types for JavaScript.

JavaScript shares most grammar rules with TypeScript minus the type annotations
and ``interface_declaration`` node, so we just re-export the TS constants.
"""

from daddy_agent.codebase_graph.queries.typescript import (
    CALL_NODE,
    CLASS_NODE,
    EXTENDS_CLAUSE,
    FUNCTION_NODES,
    HERITAGE_NODE,
    IMPLEMENTS_CLAUSE,
    IMPORT_NODE,
    METHOD_NODE,
)

__all__ = [
    "CALL_NODE",
    "CLASS_NODE",
    "EXTENDS_CLAUSE",
    "FUNCTION_NODES",
    "HERITAGE_NODE",
    "IMPLEMENTS_CLAUSE",
    "IMPORT_NODE",
    "METHOD_NODE",
]
