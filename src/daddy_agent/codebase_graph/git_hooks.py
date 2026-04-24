"""Install a ``.git/hooks/post-commit`` hook that runs ``daddy-index --incremental``.

Design notes:

* We do **not** overwrite an existing hook; instead we append a sentinel block
  so that other tools' hooks continue to work.
* The hook launches the indexer in the background (``&``) so commits stay
  snappy even on larger repos.
"""

from __future__ import annotations

import argparse
import logging
import stat
import sys
from collections.abc import Iterable
from pathlib import Path

log = logging.getLogger(__name__)


HOOK_SENTINEL_START = "# >>> daddy-agent codebase graph >>>"
HOOK_SENTINEL_END = "# <<< daddy-agent codebase graph <<<"

HOOK_BODY = """#!/usr/bin/env bash
{start}
# Runs after every commit; updates the codebase knowledge graph in the
# background so commit latency stays below 50ms even on big repos.
(daddy-index --incremental >/dev/null 2>&1 &) >/dev/null 2>&1 || true
{end}
""".format(start=HOOK_SENTINEL_START, end=HOOK_SENTINEL_END)


class HookInstallError(RuntimeError):
    """Raised when the hook cannot be installed."""


def install_hook(repo: Path | str) -> Path:
    """Install the post-commit hook into ``repo/.git/hooks``.

    Returns the path to the hook file.  Idempotent: if our sentinel block is
    already present, the file is left untouched.
    """

    repo_path = Path(repo).resolve()
    git_dir = repo_path / ".git"
    if not git_dir.exists():
        raise HookInstallError(f"not a git repository: {repo_path}")
    if git_dir.is_file():
        # git worktree or submodule: follow the pointer.
        content = git_dir.read_text("utf-8").strip()
        if content.startswith("gitdir:"):
            target = content.split(":", 1)[1].strip()
            git_dir = (repo_path / target).resolve()

    hooks_dir = git_dir / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    hook_path = hooks_dir / "post-commit"

    if hook_path.exists():
        existing = hook_path.read_text("utf-8")
        if HOOK_SENTINEL_START in existing:
            log.info("post-commit hook already installed at %s", hook_path)
            _make_executable(hook_path)
            return hook_path
        merged = existing.rstrip() + "\n\n" + HOOK_BODY
        hook_path.write_text(merged, "utf-8")
    else:
        hook_path.write_text(HOOK_BODY, "utf-8")

    _make_executable(hook_path)
    log.info("installed post-commit hook at %s", hook_path)
    return hook_path


def uninstall_hook(repo: Path | str) -> bool:
    """Remove our sentinel block from the hook, if present. Returns True on change."""

    repo_path = Path(repo).resolve()
    hook_path = repo_path / ".git" / "hooks" / "post-commit"
    if not hook_path.is_file():
        return False
    text = hook_path.read_text("utf-8")
    if HOOK_SENTINEL_START not in text:
        return False
    before, _, rest = text.partition(HOOK_SENTINEL_START)
    _, _, after = rest.partition(HOOK_SENTINEL_END)
    new_text = (before.rstrip() + "\n" + after.lstrip()).strip() + "\n"
    if new_text.strip() == "#!/usr/bin/env bash":
        hook_path.unlink()
    else:
        hook_path.write_text(new_text, "utf-8")
    return True


def _make_executable(path: Path) -> None:
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="daddy-install-git-hook",
        description="Install/uninstall the codebase graph post-commit hook.",
    )
    parser.add_argument("repo", nargs="?", default=".", help="repository root")
    parser.add_argument("--uninstall", action="store_true", help="remove the hook")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    repo = Path(args.repo).resolve()
    try:
        if args.uninstall:
            changed = uninstall_hook(repo)
            print("uninstalled" if changed else "nothing to do")
        else:
            path = install_hook(repo)
            print(f"installed: {path}")
    except HookInstallError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


__all__ = ["HookInstallError", "install_hook", "main", "uninstall_hook"]
