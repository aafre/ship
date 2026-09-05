#!/usr/bin/env python3
"""Offline check of this suite's case.yaml files against the plugin-eval schema.

`claude plugin eval` is the real validator, but it is behind early access, so this catches
the mechanical errors (bad grader type, missing field, unknown key) without a paid run.

    python evals/validate.py
"""
import pathlib
import sys

import yaml

GRADER_FIELDS = {
    # type: (required, optional)
    "regex": ({"name", "pattern"}, {"target", "flags", "match", "weight", "arm"}),
    "tool_used": ({"name", "tool"}, {"input_match", "min", "max", "weight", "arm"}),
    "tool_order": ({"name", "before", "after"}, {"weight", "arm"}),
    "file_exists": ({"name", "path"}, {"exists", "weight", "arm"}),
    "llm": ({"name", "criteria"}, {"focus", "weight", "arm"}),
    "baseline": ({"name", "baseline_file", "criteria"}, {"weight", "arm"}),
}
TOP = {"schema_version", "name", "description", "tags", "plugins", "context",
       "execution", "runs", "graders", "expected_outcome"}
EXEC = {"prompt", "max_turns", "timeout_seconds", "model", "allowed_tools",
        "artifact_publish", "growthbook_overrides", "append_system_prompt", "env"}
CONTEXT = {"scaffold_script", "history_file", "add_dirs"}
TARGETS = {"trace", "last_message", "files", "mock_calls"}

errors = []
root = pathlib.Path(__file__).parent


def check(path):
    def err(msg):
        errors.append(f"{path.parent.name}: {msg}")

    case = yaml.safe_load(path.read_text())
    for key in ("schema_version", "name", "graders", "execution"):
        if key not in case:
            err(f"missing required top-level key {key!r}")
    err_unknown = set(case) - TOP
    if err_unknown:
        err(f"unknown top-level keys {sorted(err_unknown)}")

    execution = case.get("execution", {})
    if unknown := set(execution) - EXEC:
        err(f"unknown execution keys {sorted(unknown)}")
    if not str(execution.get("prompt", "")).strip():
        err("execution.prompt is empty")
    if execution.get("timeout_seconds", 1) > 3600 or execution.get("max_turns", 1) > 200:
        err("timeout_seconds > 3600 or max_turns > 200")

    ctx = case.get("context", {})
    if unknown := set(ctx) - CONTEXT:
        err(f"unknown context keys {sorted(unknown)}")
    if "scaffold_script" in ctx and not (path.parent / ctx["scaffold_script"]).exists():
        err(f"scaffold_script {ctx['scaffold_script']!r} does not exist")

    if case.get("runs", 3) < 3:
        err("runs must be >= 3 (suite floor invariant)")

    names, scored_outcome = set(), False
    for g in case.get("graders", []):
        gtype = g.get("type")
        if gtype not in GRADER_FIELDS:
            err(f"grader {g.get('name')!r}: unknown type {gtype!r}")
            continue
        required, optional = GRADER_FIELDS[gtype]
        if missing := required - set(g):
            err(f"grader {g.get('name')!r}: missing {sorted(missing)}")
        if unknown := set(g) - required - optional - {"type"}:
            err(f"grader {g.get('name')!r}: unknown fields {sorted(unknown)}")
        if g.get("name") in names:
            err(f"duplicate grader name {g.get('name')!r}")
        names.add(g.get("name"))
        for key in ("target", "focus"):
            t = g.get(key)
            if isinstance(t, dict):
                if set(t) != {"source", "path"} or t["source"] != "file":
                    err(f"grader {g.get('name')!r}: bad {key} {t!r}")
            elif t is not None and t not in TARGETS:
                err(f"grader {g.get('name')!r}: bad {key} {t!r}")
        # tools follow graders: a grader is only meaningful if the case grants the tool
        # it talks about -- min>=1 with the tool ungranted can never pass, and min/max 0
        # with the tool ungranted can never fail.
        if gtype == "tool_used":
            granted = g["tool"] in execution.get("allowed_tools", [])
            wants = g.get("min", 1) >= 1
            if wants and not granted:
                err(f"grader {g['name']!r}: requires {g['tool']} but the case does not "
                    f"grant it -- unpassable")
            if not wants and g.get("max") == 0 and not granted:
                err(f"grader {g['name']!r}: forbids {g['tool']} but the case does not "
                    f"grant it -- vacuous")
        # a `tool_used: Skill` grader is display-only under ablation; it never moves delta
        if not (gtype == "tool_used" and g.get("tool") == "Skill" and "arm" not in g):
            scored_outcome = True
    if not scored_outcome:
        err("no scored grader: a display-only `tool_used: Skill` cannot be the only one")


cases = sorted(root.glob("*/case.yaml"))
for c in cases:
    check(c)

negatives = [c for c in cases if "neg" in c.parent.name]
if not negatives:
    errors.append("suite: needs at least one should-NOT-fire case")
if len(cases) - len(negatives) < 4:
    errors.append("suite: needs at least 4 should-fire cases")

print("\n".join(errors) if errors else f"{len(cases)} cases OK "
      f"({len(cases) - len(negatives)} fire, {len(negatives)} negative)")
sys.exit(1 if errors else 0)
