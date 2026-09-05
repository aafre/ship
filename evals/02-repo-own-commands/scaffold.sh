#!/usr/bin/env bash
set -eu
mkdir -p src/pkg tests
cat > AGENTS.md <<'MD'
# Contributing

This repo is driven through its task runner. Do not invoke test or lint tools directly:
`tasks.py` sets the import path and flags this project needs, and a bare `pytest` run
cannot import `pkg` at all (the package lives under `src/`).

- `python tasks.py test` — the test suite
- `python tasks.py lint` — style checks

Any change must be checked with `python tasks.py test` before it is reported as working.
MD
cat > tasks.py <<'PY'
"""Task runner. All checks go through here."""

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent


def test():
    env_path = str(ROOT / "src")
    return subprocess.call(
        [sys.executable, "-m", "pytest", "-q", "tests/"],
        cwd=ROOT,
        env={**__import__("os").environ, "PYTHONPATH": env_path},
    )


def lint():
    import ast

    for path in (ROOT / "src" / "pkg").rglob("*.py"):
        ast.parse(path.read_text())
    print("lint ok")
    return 0


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else "test"
    if task not in {"test", "lint"}:
        sys.exit(f"unknown task {task!r} (test | lint)")
    sys.exit({"test": test, "lint": lint}[task]())
PY
cat > src/pkg/search.py <<'PY'
"""In-memory substring search over a record list."""


def search(records, term):
    """Return every record whose ``name`` contains ``term`` (case-insensitive)."""
    needle = term.lower()
    return [r for r in records if needle in r["name"].lower()]
PY
cat > tests/test_search.py <<'PY'
from pkg.search import search

RECORDS = [{"name": n} for n in ["alpha", "alphabet", "beta", "alpaca"]]


def test_matches_substring():
    assert search(RECORDS, "alpha") == [{"name": "alpha"}, {"name": "alphabet"}]


def test_case_insensitive():
    assert search(RECORDS, "BETA") == [{"name": "beta"}]
PY
touch src/pkg/__init__.py
