"""Read-only Cypher guard.

The ``run_cypher`` MCP tool lets agents (or curious humans) issue raw
Cypher against the codebase database.  We absolutely must not let them
mutate it, so this module implements a conservative validator: it strips
string literals and comments, tokenises the remainder, and refuses any
statement that contains a mutating keyword or mutating ``apoc.*`` /
``db.*`` / ``gds.*`` procedure call.

Philosophy: false-positives are acceptable (the user can rephrase a
read-only query), silent false-negatives are not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# --------------------------------------------------------------------------- #
# Public surface
# --------------------------------------------------------------------------- #

FORBIDDEN_KEYWORDS: frozenset[str] = frozenset(
    {
        "CREATE",
        "MERGE",
        "DELETE",
        "DETACH",  # DETACH DELETE
        "SET",
        "REMOVE",
        "DROP",
        "LOAD",  # LOAD CSV
        "FOREACH",
        "START",  # legacy mutating syntax
    }
)

# APOC / GDS / db.* procedures that *might* mutate.  We match substrings on
# the fully-qualified procedure name after stripping whitespace.
FORBIDDEN_PROCEDURE_SUBSTRINGS: tuple[str, ...] = (
    "apoc.create",
    "apoc.merge",
    "apoc.refactor",
    "apoc.periodic",
    "apoc.load",
    "apoc.trigger",
    "apoc.cypher.doit",
    "apoc.cypher.run",
    "apoc.cypher.runschema",
    "apoc.cypher.runwrite",
    "apoc.export",
    "apoc.import",
    "apoc.schema.assert",
    "mutate",  # any procedure name containing "mutate"
    "db.create",
    "db.drop",
    "db.index.create",
    "db.index.drop",
    "db.constraint",
    "dbms.security",
    "gds.graph.project",
    "gds.graph.drop",
    "gds.graph.write",
    ".write",  # e.g. gds.pageRank.write
)


class ReadOnlyViolation(ValueError):
    """Raised when a Cypher statement attempts to mutate the graph."""


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of a read-only validation pass."""

    ok: bool
    reason: str | None = None


# --------------------------------------------------------------------------- #
# Stripping helpers
# --------------------------------------------------------------------------- #

# ``//`` to end-of-line, plus block comments ``/* ... */``.
_LINE_COMMENT_RE = re.compile(r"//[^\n]*")
_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)

# Single or double-quoted string, with backslash escapes.
_STRING_LITERAL_RE = re.compile(
    r"""
    '(?:\\.|[^'\\])*'      # '...'
    |
    "(?:\\.|[^"\\])*"      # "..."
    """,
    re.VERBOSE,
)

# Backtick-quoted identifiers can contain keywords like CREATE without it
# being a real CREATE.  We replace them with a placeholder too.
_BACKTICK_IDENT_RE = re.compile(r"`[^`]*`")

_WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*")


def _strip_noise(query: str) -> str:
    """Remove comments, string literals and back-ticked identifiers."""
    q = _BLOCK_COMMENT_RE.sub(" ", query)
    q = _LINE_COMMENT_RE.sub(" ", q)
    q = _STRING_LITERAL_RE.sub("''", q)
    q = _BACKTICK_IDENT_RE.sub("`ident`", q)
    return q


# --------------------------------------------------------------------------- #
# Validator
# --------------------------------------------------------------------------- #


def validate_read_only_cypher(query: str) -> ValidationResult:
    """Return a :class:`ValidationResult` describing why a query is unsafe.

    The caller can either inspect the result or use :func:`ensure_read_only`
    for an exception-raising wrapper.
    """
    if not isinstance(query, str) or not query.strip():
        return ValidationResult(False, "empty query")

    stripped = _strip_noise(query)
    upper = stripped.upper()

    # 1. forbidden keywords as standalone tokens
    for word_match in _WORD_RE.finditer(stripped):
        token = word_match.group(0)
        head = token.split(".", 1)[0].upper()
        if head in FORBIDDEN_KEYWORDS:
            # Allow ``ON CREATE SET`` / ``ON MATCH SET`` detection — both still
            # mutate, so we keep rejecting.  SET is already forbidden.  The
            # keyword list above is intentionally conservative.
            return ValidationResult(
                False, f"forbidden keyword: {head}"
            )

    # 2. forbidden procedure substrings (CALL apoc.create.node, etc.)
    lowered = stripped.lower()
    # Normalise whitespace between ``CALL`` and the procedure name so that
    # ``CALL   apoc.create.node()`` still triggers.
    call_proc_re = re.compile(
        r"\bcall\s+((?:apoc|gds|db|dbms)\.[a-zA-Z0-9_.]+)",
        re.IGNORECASE,
    )
    for match in call_proc_re.finditer(lowered):
        proc = match.group(1)
        for needle in FORBIDDEN_PROCEDURE_SUBSTRINGS:
            if needle in proc:
                return ValidationResult(
                    False, f"forbidden procedure: {proc}"
                )

    # Also guard against bare ``apoc.create.node(...)`` used as a function
    # expression (APOC has both forms).
    for needle in FORBIDDEN_PROCEDURE_SUBSTRINGS:
        if needle in lowered and needle.startswith(("apoc.", "gds.", "db.")):
            return ValidationResult(
                False, f"forbidden procedure reference: {needle}"
            )

    # 3. USING PERIODIC COMMIT is a write-only construct.
    if "USING PERIODIC COMMIT" in upper:
        return ValidationResult(False, "forbidden: USING PERIODIC COMMIT")

    return ValidationResult(True)


def ensure_read_only(query: str) -> None:
    """Raise :class:`ReadOnlyViolation` if *query* is not read-only."""
    result = validate_read_only_cypher(query)
    if not result.ok:
        raise ReadOnlyViolation(result.reason or "query is not read-only")


__all__ = [
    "FORBIDDEN_KEYWORDS",
    "FORBIDDEN_PROCEDURE_SUBSTRINGS",
    "ReadOnlyViolation",
    "ValidationResult",
    "ensure_read_only",
    "validate_read_only_cypher",
]
