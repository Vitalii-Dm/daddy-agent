"""Git coupling analysis.

``git log --name-only --pretty=format:COMMIT`` is parsed into per-commit file
sets; for every unordered pair that co-occurred in at least one commit we
compute a Jaccard-style coupling strength in ``[0, 1]``:

.. math::  strength = \\frac{co(a, b)}{|commits(a) \\cup commits(b)|}

Pairs below :data:`MIN_STRENGTH` are discarded to keep the graph sparse.

The result is written as ``(:File)-[:GIT_COUPLED {strength}]->(:File)`` edges
via :func:`write_coupling`. Edges are stored in both directions so that
undirected traversals work without ``OR`` tricks.
"""

from __future__ import annotations

import logging
import subprocess
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


#: Minimum coupling strength to keep an edge.
MIN_STRENGTH = 0.1
#: Maximum files touched in a single commit to consider (skip mega-commits).
MAX_COMMIT_FILES = 200


@dataclass(frozen=True)
class CouplingPair:
    """A coupling edge between two files."""

    a: str
    b: str
    strength: float
    co_occurrences: int


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _run_git_log(repo: Path, *, max_commits: int | None = None) -> str:
    cmd = [
        "git",
        "-C",
        str(repo),
        "log",
        "--name-only",
        "--pretty=format:__COMMIT__%H",
    ]
    if max_commits is not None:
        cmd.insert(4, f"-{int(max_commits)}")
    result = subprocess.run(  # noqa: S603 - argv is hard-coded
        cmd, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"git log failed: {result.stderr.strip()}")
    return result.stdout


def _parse_commits(git_output: str) -> list[set[str]]:
    commits: list[set[str]] = []
    current: set[str] = set()
    for line in git_output.splitlines():
        if line.startswith("__COMMIT__"):
            if current:
                commits.append(current)
            current = set()
        elif line.strip():
            current.add(line.strip())
    if current:
        commits.append(current)
    return commits


# ---------------------------------------------------------------------------
# Coupling computation
# ---------------------------------------------------------------------------


def compute_coupling(
    repo: Path | str,
    *,
    max_commits: int | None = None,
    min_strength: float = MIN_STRENGTH,
    git_output: str | None = None,
) -> list[CouplingPair]:
    """Compute coupling pairs from a git history.

    ``git_output`` can be injected for tests; otherwise we shell out to ``git``.
    """

    if git_output is None:
        git_output = _run_git_log(Path(repo), max_commits=max_commits)
    commits = _parse_commits(git_output)

    # Count co-occurrences and per-file commit counts.
    file_commits: defaultdict[str, int] = defaultdict(int)
    co: defaultdict[tuple[str, str], int] = defaultdict(int)

    for files in commits:
        if not files or len(files) > MAX_COMMIT_FILES:
            continue
        sorted_files = sorted(files)
        for f in sorted_files:
            file_commits[f] += 1
        n = len(sorted_files)
        for i in range(n):
            for j in range(i + 1, n):
                co[(sorted_files[i], sorted_files[j])] += 1

    pairs: list[CouplingPair] = []
    for (a, b), co_count in co.items():
        union = file_commits[a] + file_commits[b] - co_count
        if union <= 0:
            continue
        strength = co_count / union
        if strength < min_strength:
            continue
        pairs.append(CouplingPair(a=a, b=b, strength=round(strength, 4), co_occurrences=co_count))

    pairs.sort(key=lambda p: (-p.strength, p.a, p.b))
    return pairs


# ---------------------------------------------------------------------------
# Neo4j write
# ---------------------------------------------------------------------------


WRITE_COUPLING = """
MERGE (a:File {path: $a})
MERGE (b:File {path: $b})
MERGE (a)-[r1:GIT_COUPLED]->(b)
SET r1.strength = $strength, r1.co_occurrences = $co
MERGE (b)-[r2:GIT_COUPLED]->(a)
SET r2.strength = $strength, r2.co_occurrences = $co
"""


def write_coupling(session: Any, pairs: Iterable[CouplingPair]) -> int:
    """Persist coupling edges. Returns the number of writes performed."""

    run = getattr(session, "run", None)
    if not callable(run):
        raise TypeError("write_coupling() requires a neo4j-compatible session")

    count = 0
    for pair in pairs:
        run(
            WRITE_COUPLING,
            a=pair.a,
            b=pair.b,
            strength=pair.strength,
            co=pair.co_occurrences,
        )
        count += 1
    return count
