"""Tests for the TypeScript branch of the Tree-sitter parser."""

from __future__ import annotations

import pytest

pytest.importorskip("tree_sitter_language_pack")

from daddy_agent.codebase_graph.parser import parse_file  # noqa: E402


def test_parse_typescript_fixture_extracts_exports(fixtures_dir):
    parsed = parse_file(fixtures_dir / "sample.ts")

    assert parsed.language == "typescript"
    fn_names = {fn.name for fn in parsed.functions}
    # ``greet`` is an exported function; ``chain`` is an arrow function.
    assert "greet" in fn_names
    assert "chain" in fn_names


def test_parse_typescript_fixture_extracts_class_heritage(fixtures_dir):
    parsed = parse_file(fixtures_dir / "sample.ts")
    dog = next(c for c in parsed.classes if c.name == "Dog")
    assert "Animal" in dog.extends
    assert "Barkable" in dog.implements

    method_names = {m.name for m in dog.methods}
    assert {"bark", "fetch"} <= method_names


def test_parse_typescript_captures_calls_and_imports(fixtures_dir):
    parsed = parse_file(fixtures_dir / "sample.ts")

    greet = next(fn for fn in parsed.functions if fn.name == "greet")
    assert "helper" in greet.calls

    modules = {imp.module for imp in parsed.imports}
    assert "./helpers" in modules
