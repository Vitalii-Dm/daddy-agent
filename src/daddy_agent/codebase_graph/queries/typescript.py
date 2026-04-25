"""Tree-sitter node types for TypeScript / TSX.

Shared with :mod:`javascript` via the parser's dispatch table; this module
lists node types that are strictly TS (``interface_declaration``) plus the
ones that overlap with JS.
"""

FUNCTION_NODES = (
    "function_declaration",
    "function",
    "arrow_function",
    "function_expression",
    "generator_function_declaration",
)
CLASS_NODE = "class_declaration"
INTERFACE_NODE = "interface_declaration"
METHOD_NODE = "method_definition"
CALL_NODE = "call_expression"
IMPORT_NODE = "import_statement"

EXTENDS_CLAUSE = "extends_clause"
IMPLEMENTS_CLAUSE = "implements_clause"
HERITAGE_NODE = "class_heritage"
