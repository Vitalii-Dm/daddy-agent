"""Tests for :mod:`daddy_agent.codebase_graph.ingester`."""

from __future__ import annotations

from daddy_agent.codebase_graph.ingester import ingest_file, ingest_many
from daddy_agent.codebase_graph.parser import (
    ParsedClass,
    ParsedFile,
    ParsedFunction,
    ParsedImport,
)


def _sample_file() -> ParsedFile:
    return ParsedFile(
        path="pkg/mod.py",
        language="python",
        hash="deadbeef",
        functions=[
            ParsedFunction(
                name="greet",
                signature="greet(name)",
                docstring="hi",
                start_line=1,
                end_line=3,
                calls=["print", "name.upper"],
            )
        ],
        classes=[
            ParsedClass(
                name="Dog",
                docstring="woof",
                extends=["Animal"],
                implements=["Barkable"],
                methods=[
                    ParsedFunction(
                        name="bark",
                        signature="bark(self)",
                        docstring=None,
                        start_line=5,
                        end_line=7,
                        calls=["woof"],
                    )
                ],
                start_line=4,
                end_line=8,
            )
        ],
        imports=[ParsedImport(module="os"), ParsedImport(module="typing", alias="List")],
    )


def test_ingest_file_writes_file_node(fake_session):
    ingest_file(fake_session, _sample_file())

    merges = fake_session.queries_containing("MERGE (f:File")
    assert merges, "expected at least one File MERGE"
    first = merges[0]
    assert first.params["path"] == "pkg/mod.py"
    assert first.params["language"] == "python"
    assert first.params["hash"] == "deadbeef"


def test_ingest_file_emits_function_with_params(fake_session):
    ingest_file(fake_session, _sample_file())

    function_calls = fake_session.queries_containing("MERGE (fn:Function")
    assert function_calls
    params = function_calls[0].params
    assert params["name"] == "greet"
    assert params["signature"] == "greet(name)"
    # qualified_name is scoped by file path so ``greet`` in two files stays distinct
    assert params["qualified_name"] == "pkg/mod.py::greet"
    assert params["path"] == "pkg/mod.py"


def test_ingest_file_emits_class_extends_and_implements(fake_session):
    ingest_file(fake_session, _sample_file())

    extends = fake_session.queries_containing("EXTENDS")
    implements = fake_session.queries_containing("IMPLEMENTS")
    assert extends
    assert implements
    assert extends[0].params["parent_name"] == "Animal"
    assert implements[0].params["parent_name"] == "Barkable"


def test_ingest_file_emits_method(fake_session):
    ingest_file(fake_session, _sample_file())

    method_calls = fake_session.queries_containing("MERGE (m:Method")
    assert method_calls
    mp = method_calls[0].params
    assert mp["name"] == "bark"
    assert mp["class_name"] == "Dog"
    assert mp["qualified_name"] == "pkg/mod.py::class::Dog::bark"


def test_ingest_file_emits_call_edges(fake_session):
    ingest_file(fake_session, _sample_file())

    calls = fake_session.queries_containing("MERGE (callee:Function")
    callee_names = {c.params["callee_name"] for c in calls}
    assert {"print", "name.upper", "woof"} <= callee_names


def test_ingest_file_emits_imports(fake_session):
    ingest_file(fake_session, _sample_file())

    imports = fake_session.queries_containing("MERGE (m:Module")
    modules = {c.params["module"] for c in imports}
    assert {"os", "typing"} <= modules


def test_ingest_file_deletes_previous_children_before_insert(fake_session):
    ingest_file(fake_session, _sample_file())

    detach = fake_session.queries_containing("DETACH DELETE")
    assert detach, "expected idempotent cleanup step"


def test_ingest_many_handles_multiple_files(fake_session):
    files = [_sample_file(), _sample_file()]
    total = ingest_many(fake_session, files)
    assert total > 0
    # both files got their own File MERGE
    assert len(fake_session.queries_containing("MERGE (f:File")) == 2


# --------------------------------------------------------------------------- #
# Regression pins for review-round-2 fixes
# --------------------------------------------------------------------------- #

import pytest

from daddy_agent.codebase_graph.ingester import _flush_batch


class _ExecuteWriteSession:
    """Fake session that exposes ``execute_write`` so we exercise the
    atomic-batch path (not the fallback path hit by plain ``FakeSession``)."""

    def __init__(self, *, raise_on_write: Exception | None = None) -> None:
        self.raise_on_write = raise_on_write
        self.work_called = 0
        self.tx_runs: list[tuple[str, dict]] = []

    class _Tx:
        def __init__(self, outer: "_ExecuteWriteSession") -> None:
            self._outer = outer

        def run(self, query: str, **params) -> None:
            self._outer.tx_runs.append((query, params))

    def execute_write(self, work):
        if self.raise_on_write is not None:
            raise self.raise_on_write
        self.work_called += 1
        return work(self._Tx(self))


def test_flush_batch_uses_execute_write_when_available():
    """Pin: when the session has ``execute_write`` we use it — no fallback."""

    session = _ExecuteWriteSession()
    _flush_batch(session, [_sample_file()])
    assert session.work_called == 1
    # MERGE (f:File ...) ran inside the transaction, not on the session.
    assert any("MERGE (f:File" in q for q, _ in session.tx_runs)


def test_flush_batch_raises_on_write_tx_failure():
    """Pin: transaction errors must propagate — no silent per-file fallback.

    Falling back on tx failure would erase atomicity and leave the caller
    thinking the batch succeeded; round-2 fix required this contract.
    """

    boom = RuntimeError("tx rollback")
    session = _ExecuteWriteSession(raise_on_write=boom)
    with pytest.raises(RuntimeError, match="tx rollback"):
        _flush_batch(session, [_sample_file()])
