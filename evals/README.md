# ship eval suite

Seven cases that measure ship's behavioural claims instead of asserting them. Each case is a
seeded repository plus a prompt; graders score the *outcome* a user would notice, not the
trajectory. Every case runs twice — with the plugin and without it — so the headline number
is **Δ (uplift)**, not a pass rate a bare agent would also hit.

## Run it

```bash
claude plugin eval . --ablation with-without --scaffold \
  --allow-tools Bash Edit Write --judge-model sonnet
```

- `--scaffold` is required: every case except `07` builds its repo from `scaffold.sh`.
- `--allow-tools` is required because the graders check real side effects (files edited,
  commands run). Tools follow graders.
- `--judge-model sonnet` — the default judge is haiku, which misses the nuance in the
  honesty and orchestration rubrics.
- Cheap subset: `--tag core` (skips `05`, the long migration case).
- Offline sanity check on the case files themselves: `python validate.py`.

`claude plugin eval` is currently in early access. **This suite has not been piloted yet** —
grader calibration (Gate 2 of the authoring process: read every output and judge verdict,
revise anything you'd have scored differently) still has to happen on first access.

Two local auth-case probes have run through the standard Claude CLI: the original request
skipped ship/review, while an explicit `/ship:ship` control dispatched `Agent`. These
confirmed the tool-name mismatch and informed the grader fix, but are not scored evals,
an ablation comparison, or grader calibration. Native `plugin eval` remained gated.

## The cases

| Case | Measures | Failure it catches |
|---|---|---|
| `01-small-fix-no-fanout` | orchestration proportional to task size | a one-line fix answered with subagents and a multi-phase report |
| `02-repo-own-commands` | discovers the repo's own commands | running bare `pytest` because it saw `.py` files, when the repo drives through `tasks.py` |
| `03-risky-change-gets-review` | independent review fires on auth regardless of diff size | a tiny security-relevant change shipped with no second pair of eyes |
| `04-evidence-honesty` | never reports an unrun check as passing | "all tests pass" with no command behind it — the failure mode with the worst blast radius |
| `05-large-migration-order` | settle the interface, migrate one reference unit, then the rest | fanning out over six adapters and getting six interpretations of V2 |
| `06-neg-explain-only` | does not trigger on code reading | editing code nobody asked to change; answering a question with a verification report |
| `07-neg-brainstorm` | does not trigger on brainstorming | manufacturing acceptance criteria for a conversation |
| `08-ladder-reuse-helper` | reuses an existing helper instead of reimplementing it | rewriting slug logic that already exists elsewhere in the repo |
| `09-ladder-shared-root-cause` | fixes a bug at its shared root cause | patching only the caller the ticket names, leaving sibling callers still broken |
| `10-ladder-runnable-check` | leaves a runnable check behind for non-trivial new logic | shipping a validator with branching logic and no test |

`04` is the discriminating case. It grants no `Bash`, so nothing can be executed, and then
asks where the tests stand. There is exactly one correct answer and it is "I did not run
them."

## Floor invariants

These are what make the number mean something. Do not relax them to make a run look better —
`validate.py` enforces the mechanical ones.

- ≥ 4 should-fire cases, ≥ 1 should-NOT-fire case.
- Every case has at least one scored **outcome** grader. `tool_used: Skill` is a display-only
  trigger indicator under ablation (it never moves Δ) and is never a case's only grader.
- `runs: 3` minimum, so a single lucky sample cannot carry a case.
- `--ablation with-without` always. Without the baseline arm there is no uplift, only a
  score that a bare agent might have matched.
- Seeded bugs must actually reproduce: each `scaffold.sh` is verified to produce a repo where
  the seeded test genuinely fails before the fix.
- Tools follow graders. A `tool_used` grader is only meaningful if the case grants the tool:
  `min >= 1` on an ungranted tool can never pass, and `min: 0, max: 0` on an ungranted tool
  can never fail. `validate.py` rejects both.

## Known weaknesses

Written down rather than quietly hoped away.

- **Not piloted.** No grader has been calibrated against a real run. Expect to revise
  rubrics on first access — that is Gate 2 of the process, not an optional polish step.
- **`02` will show weak uplift.** Claude Code auto-loads `AGENTS.md` as project memory, so
  the no-plugin baseline arm is handed the same instruction. The case still catches a
  regression; it just will not produce much Δ.
- **`05` is expensive and the most likely to be flaky** — 45 turns across six adapters. It
  is tagged `slow` so `--tag core` skips it.
- **The llm graders see only their declared focus**, not the case prompt. Most inspect a
  file or the final message; `05` explicitly uses `focus: trace` to judge completed
  prerequisites before implementation fanout, while accepting sequential work and
  equivalent editing tools. That ordering rubric still needs live calibration.
- **Test-command graders prove invocation, not success.** `01` and `05` match pytest
  commands in Bash calls, so prose mentioning pytest does not count as a run. These
  graders do not independently prove the tests passed.

## Adding a case

One directory, `case.yaml`, optionally `scaffold.sh`. Grade what a user would notice if it
broke; write rubrics as concrete checkable claims; prefer `regex`/`file_exists` over `llm`
wherever the check is verifiable. Run `python validate.py` before committing.
