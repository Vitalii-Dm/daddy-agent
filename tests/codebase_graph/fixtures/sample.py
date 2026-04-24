"""Sample Python fixture for parser tests."""

import os  # noqa: F401 -- import is under test
from typing import List  # noqa: F401 -- import is under test


def greet(name: str) -> str:
    """Say hello to name."""
    print(name)
    return name.upper()


def chain(x):
    return greet(x)


class Animal:
    """An animal."""

    def speak(self):
        return "..."


class Dog(Animal):
    """A dog."""

    def speak(self):
        print("woof")
        return "woof"

    def fetch(self, item):
        return item
