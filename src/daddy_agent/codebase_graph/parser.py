"""Tree-sitter based source file parser.

The parser is intentionally structural and shallow: we only need enough
information to populate the Neo4j schema (functions, classes, methods, imports,
call sites, inheritance). We walk the AST manually rather than using Tree-
sitter's query engine so the package keeps working on builds of
``tree-sitter`` that ship without the query DSL.

Language dispatch lives in :data:`LANGUAGE_BY_SUFFIX`. Unknown languages
degrade gracefully — :func:`parse_file` returns an empty :class:`ParsedFile`
with ``language="unknown"`` and logs a warning instead of raising.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from daddy_agent.codebase_graph.queries import go as go_q
from daddy_agent.codebase_graph.queries import python as py_q
from daddy_agent.codebase_graph.queries import rust as rs_q
from daddy_agent.codebase_graph.queries import typescript as ts_q

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ParsedImport:
    """A resolved or unresolved module import."""

    module: str
    alias: str | None = None


@dataclass
class ParsedFunction:
    """A top-level function or a class method."""

    name: str
    signature: str
    docstring: str | None
    start_line: int
    end_line: int
    calls: list[str] = field(default_factory=list)


@dataclass
class ParsedClass:
    """A class-like declaration (class, struct, interface)."""

    name: str
    docstring: str | None
    methods: list[ParsedFunction] = field(default_factory=list)
    extends: list[str] = field(default_factory=list)
    implements: list[str] = field(default_factory=list)
    start_line: int = 0
    end_line: int = 0


@dataclass
class ParsedFile:
    """A parsed source file ready for Neo4j ingestion."""

    path: str
    language: str
    hash: str
    functions: list[ParsedFunction] = field(default_factory=list)
    classes: list[ParsedClass] = field(default_factory=list)
    imports: list[ParsedImport] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Language dispatch
# ---------------------------------------------------------------------------

LANGUAGE_BY_SUFFIX: dict[str, str] = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".go": "go",
    ".rs": "rust",
}


def detect_language(path: str | Path) -> str:
    """Return a Tree-sitter language name or ``"unknown"``."""

    suffix = Path(path).suffix.lower()
    return LANGUAGE_BY_SUFFIX.get(suffix, "unknown")


def sha256_bytes(data: bytes) -> str:
    """sha256 helper; kept here so callers don't import :mod:`hashlib`."""

    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Parser entry points
# ---------------------------------------------------------------------------


def parse_file(path: str | Path) -> ParsedFile:
    """Read ``path`` from disk and return a :class:`ParsedFile`."""

    path_obj = Path(path)
    data = path_obj.read_bytes()
    return parse_source(str(path_obj), data)


def parse_source(path: str, source: bytes) -> ParsedFile:
    """Parse ``source`` bytes treating them as the contents of ``path``.

    Separated from :func:`parse_file` so tests and the indexer can parse bytes
    read from git or pipes without hitting the filesystem twice.
    """

    language = detect_language(path)
    file_hash = sha256_bytes(source)
    if language == "unknown":
        log.warning("skipping unknown-language file: %s", path)
        return ParsedFile(path=path, language=language, hash=file_hash)

    try:
        parser = _get_parser(language)
    except Exception as exc:  # pragma: no cover - protective, depends on env
        log.warning("no Tree-sitter parser for %s (%s): %s", language, path, exc)
        return ParsedFile(path=path, language=language, hash=file_hash)

    tree = parser.parse(source)
    root = tree.root_node
    parsed = ParsedFile(path=path, language=language, hash=file_hash)

    if language == "python":
        _walk_python(root, source, parsed)
    elif language in {"typescript", "tsx", "javascript"}:
        _walk_ts_like(root, source, parsed)
    elif language == "go":
        _walk_go(root, source, parsed)
    elif language == "rust":
        _walk_rust(root, source, parsed)
    else:  # pragma: no cover - defensive
        log.warning("no walker for language %s", language)

    return parsed


# ---------------------------------------------------------------------------
# Tree-sitter lazy loader (cached so tests don't rebuild parsers each call)
# ---------------------------------------------------------------------------

_PARSER_CACHE: dict[str, Any] = {}


def _get_parser(language: str) -> Any:
    if language in _PARSER_CACHE:
        return _PARSER_CACHE[language]
    # Imported lazily so the module is importable without the pack installed
    # (tests for unknown-language handling shouldn't require the binary wheels).
    from tree_sitter_language_pack import get_parser  # type: ignore[import-not-found]

    parser = get_parser(language)
    _PARSER_CACHE[language] = parser
    return parser


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _text(node: Any, source: bytes) -> str:
    """Return the UTF-8 slice of ``source`` covered by ``node``."""

    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _iter_descendants(node: Any):
    stack = list(node.children)
    while stack:
        cur = stack.pop()
        yield cur
        stack.extend(cur.children)


def _child_by_field(node: Any, name: str) -> Any | None:
    try:
        return node.child_by_field_name(name)
    except Exception:  # pragma: no cover - old grammar
        return None


# ---------------------------------------------------------------------------
# Python walker
# ---------------------------------------------------------------------------


def _py_docstring(body: Any, source: bytes) -> str | None:
    if body is None or body.type != "block":
        return None
    for child in body.named_children:
        if child.type == "expression_statement" and child.named_children:
            inner = child.named_children[0]
            if inner.type == "string":
                text = _text(inner, source).strip()
                # Strip triple quotes if present.
                for q in ('"""', "'''", '"', "'"):
                    if text.startswith(q) and text.endswith(q):
                        return text[len(q) : -len(q)].strip()
                return text
        break
    return None


def _py_function(node: Any, source: bytes) -> ParsedFunction:
    name_node = _child_by_field(node, "name")
    params_node = _child_by_field(node, "parameters")
    body_node = _child_by_field(node, "body")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    params = _text(params_node, source) if params_node is not None else "()"
    signature = f"{name}{params}"
    calls = sorted({c for c in _py_calls_in(body_node, source) if c})
    return ParsedFunction(
        name=name,
        signature=signature,
        docstring=_py_docstring(body_node, source),
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
        calls=calls,
    )


def _py_calls_in(body: Any, source: bytes) -> list[str]:
    if body is None:
        return []
    calls: list[str] = []
    for desc in _iter_descendants(body):
        if desc.type == py_q.CALL_NODE:
            fn_node = _child_by_field(desc, "function")
            if fn_node is None and desc.children:
                fn_node = desc.children[0]
            if fn_node is None:
                continue
            calls.append(_text(fn_node, source))
    return calls


def _walk_python(root: Any, source: bytes, parsed: ParsedFile) -> None:
    for child in root.named_children:
        if child.type in py_q.IMPORT_NODES:
            _py_collect_import(child, source, parsed)
        elif child.type == py_q.FUNCTION_NODE:
            parsed.functions.append(_py_function(child, source))
        elif child.type == py_q.CLASS_NODE:
            parsed.classes.append(_py_class(child, source))


def _py_collect_import(node: Any, source: bytes, parsed: ParsedFile) -> None:
    # ``import a, b.c`` / ``from x.y import foo as bar``
    if node.type == "import_statement":
        for dotted in node.children_by_field_name("name"):
            parsed.imports.append(ParsedImport(module=_text(dotted, source)))
        if not parsed.imports or parsed.imports[-1].module == "":
            for c in node.named_children:
                parsed.imports.append(ParsedImport(module=_text(c, source)))
    elif node.type == "import_from_statement":
        mod_node = _child_by_field(node, "module_name")
        module = _text(mod_node, source) if mod_node is not None else ""
        names = [c for c in node.named_children if c is not mod_node]
        if not names:
            parsed.imports.append(ParsedImport(module=module))
            return
        for n in names:
            alias = _text(n, source)
            parsed.imports.append(
                ParsedImport(module=module, alias=alias) if module else ParsedImport(module=alias)
            )


def _py_class(node: Any, source: bytes) -> ParsedClass:
    name_node = _child_by_field(node, "name")
    body_node = _child_by_field(node, "body")
    superclasses_node = _child_by_field(node, "superclasses")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    extends: list[str] = []
    if superclasses_node is not None:
        for child in superclasses_node.named_children:
            text = _text(child, source)
            if text and text not in extends:
                extends.append(text)
    methods: list[ParsedFunction] = []
    if body_node is not None:
        for child in body_node.named_children:
            if child.type == py_q.FUNCTION_NODE:
                methods.append(_py_function(child, source))
    return ParsedClass(
        name=name,
        docstring=_py_docstring(body_node, source),
        methods=methods,
        extends=extends,
        implements=[],  # Python has no separate interface concept
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
    )


# ---------------------------------------------------------------------------
# TypeScript / JavaScript walker
# ---------------------------------------------------------------------------


def _ts_function(node: Any, source: bytes) -> ParsedFunction:
    name_node = _child_by_field(node, "name")
    params_node = _child_by_field(node, "parameters")
    body_node = _child_by_field(node, "body")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    params = _text(params_node, source) if params_node is not None else "()"
    signature = f"{name}{params}"
    calls = sorted({c for c in _ts_calls_in(body_node, source) if c})
    return ParsedFunction(
        name=name,
        signature=signature,
        docstring=None,
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
        calls=calls,
    )


def _ts_calls_in(body: Any, source: bytes) -> list[str]:
    if body is None:
        return []
    out: list[str] = []
    for desc in _iter_descendants(body):
        if desc.type == ts_q.CALL_NODE:
            fn_node = _child_by_field(desc, "function")
            if fn_node is None and desc.children:
                fn_node = desc.children[0]
            if fn_node is None:
                continue
            out.append(_text(fn_node, source))
    return out


def _ts_class(node: Any, source: bytes) -> ParsedClass:
    name_node = _child_by_field(node, "name")
    body_node = _child_by_field(node, "body")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    extends: list[str] = []
    implements: list[str] = []
    heritage = None
    for child in node.children:
        if child.type == ts_q.HERITAGE_NODE:
            heritage = child
            break
    if heritage is not None:
        for child in heritage.children:
            if child.type == ts_q.EXTENDS_CLAUSE:
                for inner in child.named_children:
                    extends.append(_text(inner, source))
            elif child.type == ts_q.IMPLEMENTS_CLAUSE:
                for inner in child.named_children:
                    implements.append(_text(inner, source))
    methods: list[ParsedFunction] = []
    if body_node is not None:
        for child in body_node.named_children:
            if child.type == ts_q.METHOD_NODE:
                methods.append(_ts_method(child, source))
    return ParsedClass(
        name=name,
        docstring=None,
        methods=methods,
        extends=extends,
        implements=implements,
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
    )


def _ts_method(node: Any, source: bytes) -> ParsedFunction:
    name_node = _child_by_field(node, "name")
    params_node = _child_by_field(node, "parameters")
    body_node = _child_by_field(node, "body")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    params = _text(params_node, source) if params_node is not None else "()"
    calls = sorted({c for c in _ts_calls_in(body_node, source) if c})
    return ParsedFunction(
        name=name,
        signature=f"{name}{params}",
        docstring=None,
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
        calls=calls,
    )


def _walk_ts_like(root: Any, source: bytes, parsed: ParsedFile) -> None:
    # TS/JS wraps top-level decls in ``export_statement`` nodes; unwrap them.
    for child in root.named_children:
        if child.type == "export_statement":
            for inner in child.named_children:
                _ts_visit_toplevel(inner, source, parsed)
            continue
        _ts_visit_toplevel(child, source, parsed)


def _ts_visit_toplevel(node: Any, source: bytes, parsed: ParsedFile) -> None:
    if node.type == ts_q.IMPORT_NODE:
        _ts_collect_import(node, source, parsed)
    elif node.type in ts_q.FUNCTION_NODES:
        parsed.functions.append(_ts_function(node, source))
    elif node.type == ts_q.CLASS_NODE:
        parsed.classes.append(_ts_class(node, source))
    elif node.type == "interface_declaration":
        parsed.classes.append(_ts_class(node, source))
    elif node.type == "lexical_declaration":
        # ``const foo = () => {}`` / ``const x = function() {}``
        _ts_collect_lexical(node, source, parsed)


def _ts_collect_import(node: Any, source: bytes, parsed: ParsedFile) -> None:
    module = ""
    for child in node.named_children:
        if child.type == "string":
            module = _text(child, source).strip("'\"`")
    if module:
        parsed.imports.append(ParsedImport(module=module))


def _ts_collect_lexical(node: Any, source: bytes, parsed: ParsedFile) -> None:
    for declarator in node.named_children:
        if declarator.type != "variable_declarator":
            continue
        name_node = _child_by_field(declarator, "name")
        value_node = _child_by_field(declarator, "value")
        if value_node is None or name_node is None:
            continue
        if value_node.type in {"arrow_function", "function", "function_expression"}:
            params_node = _child_by_field(value_node, "parameters")
            body_node = _child_by_field(value_node, "body")
            name = _text(name_node, source)
            params = _text(params_node, source) if params_node else "()"
            parsed.functions.append(
                ParsedFunction(
                    name=name,
                    signature=f"{name}{params}",
                    docstring=None,
                    start_line=declarator.start_point[0] + 1,
                    end_line=declarator.end_point[0] + 1,
                    calls=sorted({c for c in _ts_calls_in(body_node, source) if c}),
                )
            )


# ---------------------------------------------------------------------------
# Go walker
# ---------------------------------------------------------------------------


def _walk_go(root: Any, source: bytes, parsed: ParsedFile) -> None:
    for child in root.named_children:
        if child.type == "import_declaration":
            for desc in _iter_descendants(child):
                if desc.type == "interpreted_string_literal":
                    mod = _text(desc, source).strip("\"'`")
                    if mod:
                        parsed.imports.append(ParsedImport(module=mod))
        elif child.type in go_q.FUNCTION_NODES:
            parsed.functions.append(_go_function(child, source))


def _go_function(node: Any, source: bytes) -> ParsedFunction:
    name_node = _child_by_field(node, "name")
    params_node = _child_by_field(node, "parameters")
    body_node = _child_by_field(node, "body")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    params = _text(params_node, source) if params_node is not None else "()"
    calls: list[str] = []
    if body_node is not None:
        for desc in _iter_descendants(body_node):
            if desc.type == go_q.CALL_NODE:
                fn_node = _child_by_field(desc, "function")
                if fn_node is None and desc.children:
                    fn_node = desc.children[0]
                if fn_node is not None:
                    calls.append(_text(fn_node, source))
    return ParsedFunction(
        name=name,
        signature=f"{name}{params}",
        docstring=None,
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
        calls=sorted(set(calls)),
    )


# ---------------------------------------------------------------------------
# Rust walker
# ---------------------------------------------------------------------------


def _walk_rust(root: Any, source: bytes, parsed: ParsedFile) -> None:
    for child in root.named_children:
        if child.type == rs_q.IMPORT_NODE:
            for desc in _iter_descendants(child):
                if desc.type in {"scoped_identifier", "identifier"}:
                    parsed.imports.append(ParsedImport(module=_text(desc, source)))
                    break
        elif child.type == rs_q.FUNCTION_NODE:
            parsed.functions.append(_rust_function(child, source))
        elif child.type in rs_q.CLASS_NODES:
            parsed.classes.append(_rust_class(child, source))


def _rust_function(node: Any, source: bytes) -> ParsedFunction:
    name_node = _child_by_field(node, "name")
    params_node = _child_by_field(node, "parameters")
    body_node = _child_by_field(node, "body")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    params = _text(params_node, source) if params_node is not None else "()"
    calls: list[str] = []
    if body_node is not None:
        for desc in _iter_descendants(body_node):
            if desc.type == rs_q.CALL_NODE:
                fn_node = _child_by_field(desc, "function")
                if fn_node is None and desc.children:
                    fn_node = desc.children[0]
                if fn_node is not None:
                    calls.append(_text(fn_node, source))
    return ParsedFunction(
        name=name,
        signature=f"{name}{params}",
        docstring=None,
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
        calls=sorted(set(calls)),
    )


def _rust_class(node: Any, source: bytes) -> ParsedClass:
    name_node = _child_by_field(node, "name")
    name = _text(name_node, source) if name_node is not None else "<anon>"
    return ParsedClass(
        name=name,
        docstring=None,
        methods=[],
        extends=[],
        implements=[],
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
    )
