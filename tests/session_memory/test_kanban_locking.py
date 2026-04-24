"""Concurrency tests for :mod:`daddy_agent.session_memory.kanban`."""

from __future__ import annotations

import threading
from pathlib import Path

from daddy_agent.session_memory.kanban import move_card, read_board


_SEED = """## Todo
- [ ] A: first card
- [ ] B: second card
- [ ] C: third card

## Doing

## Done
"""


def _write_seed(tmp_path: Path) -> Path:
    p = tmp_path / "kanban.md"
    p.write_text(_SEED)
    return p


def test_single_move(tmp_path: Path) -> None:
    path = _write_seed(tmp_path)
    move_card(path, "A", "Todo", "Doing")
    board = read_board(path)
    assert [c.id for c in board.columns["Todo"]] == ["B", "C"]
    assert [c.id for c in board.columns["Doing"]] == ["A"]


def test_concurrent_moves_are_serialised(tmp_path: Path) -> None:
    path = _write_seed(tmp_path)
    errors: list[Exception] = []

    def mover(card_id: str) -> None:
        try:
            move_card(path, card_id, "Todo", "Doing")
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(exc)

    threads = [
        threading.Thread(target=mover, args=("A",)),
        threading.Thread(target=mover, args=("B",)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert errors == []

    board = read_board(path)
    todo_ids = [c.id for c in board.columns["Todo"]]
    doing_ids = sorted(c.id for c in board.columns["Doing"])

    # Both cards must have moved; order in Doing depends on scheduler, so sort.
    assert todo_ids == ["C"]
    assert doing_ids == ["A", "B"]

    # File must still be a parseable board (no corruption).
    text = path.read_text()
    assert text.count("## Todo") == 1
    assert text.count("## Doing") == 1
    assert text.count("## Done") == 1
