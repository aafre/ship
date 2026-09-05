#!/usr/bin/env bash
set -eu
mkdir -p pkg tests
cat > pkg/pagination.py <<'PY'
"""Offset pagination helpers."""


def page_slice(items, page, size):
    """Return the items on `page` (0-indexed), `size` items per page."""
    start = page * size
    return items[start:start + size - 1]


def page_count(items, size):
    return (len(items) + size - 1) // size
PY
cat > tests/test_pagination.py <<'PY'
from pkg.pagination import page_count, page_slice


def test_full_page():
    assert page_slice(list(range(10)), 0, 4) == [0, 1, 2, 3]


def test_last_partial_page():
    assert page_slice(list(range(10)), 2, 4) == [8, 9]


def test_page_count():
    assert page_count(list(range(10)), 4) == 3
PY
touch pkg/__init__.py
