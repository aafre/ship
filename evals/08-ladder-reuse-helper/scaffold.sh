#!/usr/bin/env bash
set -eu
mkdir -p pkg tests
cat > pkg/text_utils.py <<'PY'
"""Small text helpers shared across the app."""
import re


def slugify(text):
    """Lowercase, hyphen-separated slug: 'Hello, World!' -> 'hello-world'."""
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower())
    return text.strip("-")
PY
cat > pkg/articles.py <<'PY'
"""Article model helpers."""
PY
cat > tests/test_text_utils.py <<'PY'
from pkg.text_utils import slugify


def test_slugify_basic():
    assert slugify("Hello, World!") == "hello-world"
PY
touch pkg/__init__.py
