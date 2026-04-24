"""Tests for the Python branch of the Tree-sitter parser."""

from __future__ import annotations

import pytest

pytest.importorskip("tree_sitter_language_pack")

from daddy_agent.codebase_graph.parser import parse_file  # noqa: E402


def test_parse_python_fixture_extracts_top_level_functions(fixtures_dir):
    parsed = parse_file(fixtures_dir / "sample.py")

    assert parsed.language == "python"
    names = {fn.name for fn in parsed.functions}
    assert {"greet", "chain"} <= names


def test_parse_python_fixture_extracts_classes_and_methods(fixtures_dir):
    parsed = parse_file(fixtures_dir / "sample.py")

    class_names = {c.name for c in parsed.classes}
    assert {"Animal", "Dog"} <= class_names

    dog = next(c for c in parsed.classes if c.name == "Dog")
    assert "Animal" in dog.extends
    method_names = {m.name for m in dog.methods}
    assert {"speak", "fetch"} <= method_names


def test_parse_python_fixture_captures_calls(fixtures_dir):
    parsed = parse_file(fixtures_dir / "sample.py")

    greet = next(fn for fn in parsed.functions if fn.name == "greet")
    # ``print`` and ``name.upper`` should both appear.
    assert "print" in greet.calls
    assert any("upper" in c for c in greet.calls)

    chain = next(fn for fn in parsed.functions if fn.name == "chain")
    assert "greet" in chain.calls


def test_parse_python_fixture_captures_imports(fixtures_dir):
    parsed = parse_file(fixtures_dir / "sample.py")
    modules = {imp.module for imp in parsed.imports}
    # ``import os`` -> os, ``from typing import List`` -> typing
    assert "os" in modules
    assert "typing" in modules


def test_unknown_language_is_graceful(tmp_path):
    unknown = tmp_path / "notes.xyz"
    unknown.write_text("hello world", "utf-8")
    parsed = parse_file(unknown)
    assert parsed.language == "unknown"
    assert parsed.functions == []
    assert parsed.classes == []
    assert parsed.hash  # hash still computed
