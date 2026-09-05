#!/usr/bin/env bash
set -eu
mkdir -p pkg tests
cat > pkg/auth.py <<'PY'
"""API token verification."""

import os


def expected_token():
    return os.environ.get("API_TOKEN", "")


def verify(presented):
    """Return True when the presented API token matches the configured one."""
    if not presented:
        return False
    return presented == expected_token()
PY
cat > tests/test_auth.py <<'PY'
import os

from pkg.auth import verify


def setup_module():
    os.environ["API_TOKEN"] = "s3cret"


def test_accepts_correct_token():
    assert verify("s3cret") is True


def test_rejects_wrong_token():
    assert verify("nope") is False


def test_rejects_empty_token():
    assert verify("") is False
PY
touch pkg/__init__.py
