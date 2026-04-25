"""Tree-sitter node types for Go."""

FUNCTION_NODES = ("function_declaration", "method_declaration")
CLASS_NODE = "type_declaration"  # Go doesn't have classes; struct types stand in
STRUCT_NODE = "type_spec"
INTERFACE_NODE = "interface_type"
CALL_NODE = "call_expression"
IMPORT_NODES = ("import_declaration", "import_spec")
