"""Tests for :mod:`daddy_agent.codebase_graph.git_hooks`."""

from __future__ import annotations

import os
import stat

import pytest

from daddy_agent.codebase_graph.git_hooks import (
    HOOK_SENTINEL_END,
    HOOK_SENTINEL_START,
    HookInstallError,
    install_hook,
    uninstall_hook,
)


def _fake_repo(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git" / "hooks").mkdir(parents=True)
    return repo


def test_install_hook_creates_file_when_missing(tmp_path):
    repo = _fake_repo(tmp_path)
    path = install_hook(repo)
    assert path.is_file()
    text = path.read_text("utf-8")
    assert HOOK_SENTINEL_START in text
    assert HOOK_SENTINEL_END in text
    assert "daddy-index --incremental" in text
    # Must be executable.
    mode = path.stat().st_mode
    assert mode & stat.S_IXUSR


def test_install_hook_is_idempotent(tmp_path):
    repo = _fake_repo(tmp_path)
    path = install_hook(repo)
    first_text = path.read_text("utf-8")
    install_hook(repo)
    assert path.read_text("utf-8") == first_text


def test_install_hook_appends_to_existing_hook(tmp_path):
    repo = _fake_repo(tmp_path)
    hook_path = repo / ".git" / "hooks" / "post-commit"
    hook_path.write_text("#!/usr/bin/env bash\necho pre-existing\n", "utf-8")
    os.chmod(hook_path, 0o755)

    install_hook(repo)
    text = hook_path.read_text("utf-8")
    assert "pre-existing" in text
    assert HOOK_SENTINEL_START in text


def test_uninstall_removes_sentinel_block(tmp_path):
    repo = _fake_repo(tmp_path)
    install_hook(repo)
    changed = uninstall_hook(repo)
    assert changed is True
    hook_path = repo / ".git" / "hooks" / "post-commit"
    if hook_path.exists():
        assert HOOK_SENTINEL_START not in hook_path.read_text("utf-8")


def test_install_hook_errors_on_non_repo(tmp_path):
    with pytest.raises(HookInstallError):
        install_hook(tmp_path)
