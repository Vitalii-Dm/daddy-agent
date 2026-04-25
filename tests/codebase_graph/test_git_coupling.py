"""Tests for git coupling analysis."""

from __future__ import annotations

import shutil
import subprocess

import pytest

from daddy_agent.codebase_graph.git_coupling import (
    CouplingPair,
    compute_coupling,
    write_coupling,
)


def test_compute_coupling_parses_injected_git_output():
    # Three commits: a+b together twice, c alone once.
    git_out = """__COMMIT__1
a.py
b.py

__COMMIT__2
a.py
b.py

__COMMIT__3
c.py
"""
    pairs = compute_coupling(".", git_output=git_out, min_strength=0.0)
    assert any(p.a == "a.py" and p.b == "b.py" and p.strength == 1.0 for p in pairs)
    # ``c.py`` alone should have no couplings.
    assert not any("c.py" in (p.a, p.b) for p in pairs)


def test_compute_coupling_strength_is_jaccard():
    # a,b together twice, a alone once, b alone twice.
    # co=2, union = 3 + 4 - 2 = 5, strength = 0.4
    git_out = """__COMMIT__1
a.py
b.py

__COMMIT__2
a.py
b.py

__COMMIT__3
a.py

__COMMIT__4
b.py

__COMMIT__5
b.py
"""
    pairs = compute_coupling(".", git_output=git_out, min_strength=0.0)
    assert len(pairs) == 1
    pair = pairs[0]
    assert pair.strength == pytest.approx(0.4)
    assert 0.0 <= pair.strength <= 1.0


def test_compute_coupling_on_real_git_repo(tmp_path):
    git = shutil.which("git")
    if git is None:
        pytest.skip("git not available")

    repo = tmp_path / "repo"
    repo.mkdir()

    def run(*args):
        subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)

    run("init", "-q")
    run("config", "user.email", "t@t.test")
    run("config", "user.name", "t")
    run("commit", "--allow-empty", "-m", "init")

    (repo / "a.py").write_text("x = 1\n")
    (repo / "b.py").write_text("y = 1\n")
    run("add", "a.py", "b.py")
    run("commit", "-m", "add a+b")

    (repo / "a.py").write_text("x = 2\n")
    (repo / "b.py").write_text("y = 2\n")
    run("add", "a.py", "b.py")
    run("commit", "-m", "bump a+b")

    (repo / "c.py").write_text("z = 1\n")
    run("add", "c.py")
    run("commit", "-m", "add c alone")

    pairs = compute_coupling(repo, min_strength=0.0)
    assert any(p.a == "a.py" and p.b == "b.py" for p in pairs)


def test_write_coupling_emits_undirected_edges(fake_session):
    pair = CouplingPair(a="a.py", b="b.py", strength=0.5, co_occurrences=2)
    written = write_coupling(fake_session, [pair])
    assert written == 1

    merges = fake_session.queries_containing("GIT_COUPLED")
    assert merges
    params = merges[0].params
    assert params["a"] == "a.py"
    assert params["b"] == "b.py"
    assert 0.0 <= params["strength"] <= 1.0
    assert params["co"] == 2
