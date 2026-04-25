"""Tree-sitter node types for Rust."""

FUNCTION_NODE = "function_item"
CLASS_NODES = ("struct_item", "enum_item")  # Rust proxy for "class-like"
IMPL_NODE = "impl_item"
TRAIT_NODE = "trait_item"
CALL_NODE = "call_expression"
MACRO_CALL_NODE = "macro_invocation"
IMPORT_NODE = "use_declaration"
