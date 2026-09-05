#!/usr/bin/env bash
set -eu
mkdir -p pkg
cat > pkg/retry.py <<'PY'
"""Retry helper with exponential backoff and a total time budget."""

import random
import time

BASE_DELAY = 0.25
MAX_DELAY = 8.0
MAX_ELAPSED = 30.0


def call_with_retry(fn, attempts=5):
    """Call `fn`, retrying transient failures.

    Gives up when attempts are exhausted OR the total elapsed time would exceed
    MAX_ELAPSED, whichever comes first.
    """
    started = time.monotonic()
    delay = BASE_DELAY
    last = None
    for attempt in range(attempts):
        try:
            return fn()
        except TransientError as exc:
            last = exc
            elapsed = time.monotonic() - started
            sleep_for = min(delay, MAX_DELAY) * (0.5 + random.random())
            if attempt == attempts - 1 or elapsed + sleep_for > MAX_ELAPSED:
                break
            time.sleep(sleep_for)
            delay *= 2
    raise last


class TransientError(Exception):
    pass
PY
touch pkg/__init__.py
