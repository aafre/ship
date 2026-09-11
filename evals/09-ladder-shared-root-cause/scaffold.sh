#!/usr/bin/env bash
set -eu
mkdir -p pkg tests
cat > pkg/currency.py <<'PY'
"""Shared money helpers."""


def to_cents(amount):
    """Convert a dollar float to integer cents."""
    return int(amount * 100)
PY
cat > pkg/invoice.py <<'PY'
from pkg.currency import to_cents


def invoice_total_cents(amount):
    return to_cents(amount)
PY
cat > pkg/receipt.py <<'PY'
from pkg.currency import to_cents


def receipt_total_cents(amount):
    return to_cents(amount)
PY
cat > pkg/refund.py <<'PY'
from pkg.currency import to_cents


def refund_total_cents(amount):
    return to_cents(amount)
PY
cat > tests/test_currency.py <<'PY'
from pkg.currency import to_cents


def test_to_cents_no_float_drift():
    # 19.99 * 100 == 1998.9999999999998 in floating point; int() truncates
    # this to 1998 instead of the correct 1999.
    assert to_cents(19.99) == 1999
PY
touch pkg/__init__.py
