"""Tree-sitter node types for Python.

The parser walks the AST manually rather than running ``.query()`` because the
``tree-sitter-language-pack`` builds omit the query DSL on some platforms.  The
constants below document which node types we care about so the walker code is
self-describing.
"""

FUNCTION_NODE = "function_definition"
CLASS_NODE = "class_definition"
METHOD_NODE = "function_definition"  # methods are just functions inside classes
CALL_NODE = "call"
IMPORT_NODES = ("import_statement", "import_from_statement")

# Identifier/attribute node types used when walking call sites.
IDENT_NODES = ("identifier", "attribute")
