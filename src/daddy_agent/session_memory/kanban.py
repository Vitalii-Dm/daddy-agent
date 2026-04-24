"""Minimal shared-markdown Kanban helper.

The Kanban is a plain markdown file with ``## Column`` headings and a
``- [ ] id: title`` entry per card. Multiple agents may touch the file at the
same time so every read/write takes an :func:`fcntl.flock` on the file itself.

The link into the session graph is handled by :func:`move_card` — it calls
``log_message`` on the provided :class:`SessionHandle` so the move shows up in
short-term memory and can be picked up by the reasoning pipeline.
"""

from __future__ import annotations

import fcntl
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .lifecycle import SessionHandle, log_message

__all__ = ["Board", "Card", "move_card", "read_board"]


_CARD_RE = re.compile(r"^\s*-\s*\[(?P<done>[ xX])\]\s*(?P<id>[\w.-]+):\s*(?P<title>.*)$")
_COLUMN_RE = re.compile(r"^##\s+(?P<name>.+?)\s*$")


@dataclass
class Card:
    id: str
    title: str
    done: bool = False

    def render(self) -> str:
        mark = "x" if self.done else " "
        return f"- [{mark}] {self.id}: {self.title}"


@dataclass
class Board:
    columns: dict[str, list[Card]]

    def find(self, card_id: str) -> tuple[str, Card] | None:
        for col, cards in self.columns.items():
            for card in cards:
                if card.id == card_id:
                    return col, card
        return None

    def render(self) -> str:
        parts: list[str] = []
        for col, cards in self.columns.items():
            parts.append(f"## {col}")
            parts.extend(card.render() for card in cards)
            parts.append("")
        return "\n".join(parts).rstrip() + "\n"


@contextmanager
def _locked(path: Path, mode: str) -> Iterator[object]:
    """Open ``path`` with an exclusive :func:`fcntl.flock` held for the duration.

    ``mode`` accepts ``"r"`` or ``"r+"``. The file is created if it does not
    exist for write modes so concurrent first-writers don't race.
    """

    if "r" in mode and not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    # ``r+`` needs the file to exist; ``open`` with mode "a+" then seek(0) is
    # more forgiving but loses atomic truncation. We stick with r+ and create
    # above.
    fh = open(path, mode)
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        yield fh
    finally:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        finally:
            fh.close()


def _parse(text: str) -> Board:
    columns: dict[str, list[Card]] = {}
    current: str | None = None
    for raw in text.splitlines():
        col_match = _COLUMN_RE.match(raw)
        if col_match:
            current = col_match.group("name").strip()
            columns.setdefault(current, [])
            continue
        if current is None:
            continue
        card_match = _CARD_RE.match(raw)
        if not card_match:
            continue
        columns[current].append(
            Card(
                id=card_match.group("id"),
                title=card_match.group("title").strip(),
                done=card_match.group("done").lower() == "x",
            )
        )
    return Board(columns=columns)


def read_board(path: os.PathLike[str] | str) -> Board:
    """Read ``path`` into a :class:`Board`, taking a shared lock while reading."""

    p = Path(path)
    with _locked(p, "r") as fh:  # type: ignore[assignment]
        return _parse(fh.read())  # type: ignore[union-attr]


def move_card(
    path: os.PathLike[str] | str,
    card_id: str,
    from_col: str,
    to_col: str,
    *,
    session: SessionHandle | None = None,
) -> Board:
    """Move ``card_id`` from ``from_col`` to ``to_col`` under an exclusive lock.

    Returns the updated board. If ``session`` is provided, a short-term memory
    message is logged so the move is replayable from the graph.
    """

    p = Path(path)
    with _locked(p, "r+") as fh:  # type: ignore[assignment]
        board = _parse(fh.read())  # type: ignore[union-attr]
        if from_col not in board.columns:
            raise KeyError(f"source column {from_col!r} not on board")
        board.columns.setdefault(to_col, [])
        src = board.columns[from_col]
        moved: Card | None = None
        for i, card in enumerate(src):
            if card.id == card_id:
                moved = src.pop(i)
                break
        if moved is None:
            raise KeyError(f"card {card_id!r} not in column {from_col!r}")
        board.columns[to_col].append(moved)
        fh.seek(0)  # type: ignore[union-attr]
        fh.truncate()  # type: ignore[union-attr]
        fh.write(board.render())  # type: ignore[union-attr]

    if session is not None:
        log_message(
            session,
            role="system",
            content=f"kanban: moved {card_id} from {from_col} to {to_col}",
        )
    return board
