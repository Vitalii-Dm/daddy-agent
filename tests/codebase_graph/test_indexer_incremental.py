"""Integration-ish test for the incremental indexer.

The test builds a tiny "repo" in a tmp dir with two Python files, runs
``index_repository`` against a :class:`FakeSession`, mutates one file, and
asserts the second run only re-ingests the mutated file.
"""

from __future__ import annotations

import pytest

pytest.importorskip("tree_sitter_language_pack")
pytest.importorskip("pathspec")

from daddy_agent.codebase_graph.indexer import index_repository  # noqa: E402


def _write(path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, "utf-8")


def _seed_known_hashes(fake_session, paths_and_hashes):
    fake_session.query_results["MATCH (f:File) RETURN f.path"] = [
        {"path": p, "hash": h} for p, h in paths_and_hashes
    ]


def test_incremental_index_only_reingests_changed_files(tmp_path, fake_session):
    repo = tmp_path / "repo"
    a = repo / "a.py"
    b = repo / "b.py"
    _write(a, "def f():\n    return 1\n")
    _write(b, "def g():\n    return 2\n")

    # First run: no hashes known, both files ingested.
    result1 = index_repository(repo, session=fake_session, apply_schema_on_start=False)
    assert set(result1.indexed) == {"a.py", "b.py"}
    assert result1.skipped == []

    # Capture hashes as they were written during the first pass.
    hashes = {
        c.params["path"]: c.params["hash"]
        for c in fake_session.queries_containing("MERGE (f:File")
    }
    assert set(hashes) == {"a.py", "b.py"}

    # Reset recorded calls and teach the fake session what Neo4j "already knows".
    fake_session.calls.clear()
    _seed_known_hashes(fake_session, hashes.items())

    # Mutate only ``a.py``.
    _write(a, "def f():\n    return 99\n")

    result2 = index_repository(repo, session=fake_session, apply_schema_on_start=False)
    assert result2.indexed == ["a.py"]
    assert "b.py" in result2.skipped
    # And no File MERGE should target b.py on the second run.
    second_file_writes = {
        c.params["path"] for c in fake_session.queries_containing("MERGE (f:File")
    }
    assert second_file_writes == {"a.py"}


def test_removed_files_are_detached(tmp_path, fake_session):
    repo = tmp_path / "repo"
    a = repo / "a.py"
    b = repo / "b.py"
    _write(a, "def f():\n    return 1\n")
    _write(b, "def g():\n    return 2\n")

    index_repository(repo, session=fake_session, apply_schema_on_start=False)
    hashes = {
        c.params["path"]: c.params["hash"]
        for c in fake_session.queries_containing("MERGE (f:File")
    }

    # Delete ``b.py`` and tell the session the two old hashes are known.
    b.unlink()
    fake_session.calls.clear()
    _seed_known_hashes(fake_session, hashes.items())

    result = index_repository(repo, session=fake_session, apply_schema_on_start=False)
    assert result.removed == ["b.py"]
    detach_calls = fake_session.queries_containing("DETACH DELETE")
    assert any(c.params.get("path") == "b.py" for c in detach_calls)


def test_gitignore_is_honoured(tmp_path, fake_session):
    repo = tmp_path / "repo"
    _write(repo / "keep.py", "def f(): pass\n")
    _write(repo / "skip" / "m.py", "def f(): pass\n")
    _write(repo / ".gitignore", "skip/\n")

    result = index_repository(repo, session=fake_session, apply_schema_on_start=False)
    assert result.indexed == ["keep.py"]
