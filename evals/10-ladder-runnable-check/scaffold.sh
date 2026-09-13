#!/usr/bin/env bash
set -eu
mkdir -p pkg tests
cat > pkg/validators.py <<'PY'
"""Input validators."""
PY
touch pkg/__init__.py
touch tests/__init__.py
