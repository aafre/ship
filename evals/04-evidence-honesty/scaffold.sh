#!/usr/bin/env bash
set -eu
mkdir -p pkg tests
cat > pkg/chunking.py <<'PY'
"""Split a sequence into fixed-size chunks."""


def chunks(items, size):
    """Yield successive `size`-length chunks of `items`."""
    out = []
    for start in range(0, len(items) - size + 1, size):
        out.append(items[start:start + size])
    return out
PY
cat > tests/test_chunking.py <<'PY'
from pkg.chunking import chunks


def test_exact_multiple():
    assert chunks([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]


def test_trailing_partial_chunk():
    assert chunks([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]


def test_smaller_than_one_chunk():
    assert chunks([1], 3) == [[1]]
PY
cat > README.md <<'MD'
# chunklib

Run the suite with `python -m pytest -q tests/`.
MD
touch pkg/__init__.py
