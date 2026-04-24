"""Daddy-agent namespace package.

Sub-packages (one per concurrent Worker) live under this namespace.  The
root is intentionally light so that parallel workers can add sibling
modules without merge conflicts.
"""
