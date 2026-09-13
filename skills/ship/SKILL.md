---
name: ship
description: 'Disciplined end-to-end engineering workflow for changing code — understand the request, recon the repo, plan when it matters, implement, verify deterministically, get an independent review, validate the findings, fix, re-verify, report with evidence. Use this whenever the user asks for a code change of any real substance: a feature, bug fix, refactor, migration, performance work, API or schema change, test work, reliability or security-sensitive change, or implementing an issue, ticket, or PR feedback. Also use when the user types /ship. Do NOT use it for questions about code, explanations, code reading, brainstorming, or a one-line edit where the workflow costs more than it returns.'
---

# Ship

A senior-engineer workflow that adapts to task size. The user talks to one agent — you.
Subagents, worktrees, plans, review, and verification happen because the work needs them,
not because they exist.

Priority order when these conflict: **correctness > engineering quality > context economy >
throughput > parallelism**. Evidence beats assertion at every step. Less code beats more.

## Reference map

Read a reference only when the phase needs it. Don't preload.

| File | Read when |
|---|---|
| `references/workflow-rules.md` | Implementation, verification, and completion detail — long-form rules for steps 5, 8, 11. |
| `references/task-contract.md` | Writing the internal contract, or persisting it for a LARGE task / resuming one. |
| `references/review-contract.md` | Briefing the reviewer, or triaging the findings that come back. |
| `references/verifier-contract.md` | Briefing a verifier, choosing what a check needs, or deciding what a failure means. |
| `references/parallelism.md` | You are about to consider more than one implementation agent, a DAG, or worktrees. |
| `references/pr-strategy.md` | The goal has multiple epics — briefing the per-epic review→PR loop. |

## The loop

```
intent → understand → plan (when it earns it) → implement → deterministic verification
       → independent review → verify findings → fix → re-verify → report
```

Adaptive, not ceremonial. A SMALL task collapses most of this into two steps, and that is
correct execution, not a shortcut.

## CLI routing

This skill is always the thinking layer: understanding the goal, sizing it, asking the
consequential questions, and (for MEDIUM/LARGE work) producing the plan. When the repo has
`packages/cli` built (a resolvable `ship` command, or `node <repo>/packages/cli/dist/cli.js`),
route the mechanical, repeatable parts through it instead of hand-rolling them:

- Render the approved plan's artifacts through `ship plan`'s output (`plan.md`,
  `launch-tasks.md`, `tasks.json`) rather than writing `tasks.json` by hand.
- Once the user approves, run the graph with `ship run <run-dir> <tasks.json>` instead of a
  hand-managed loop of subagent dispatch, git worktrees, and merges — the CLI owns durable
  state, worktree lifecycle, and integrate-branch merging so a closed terminal doesn't lose
  the run.
- Check progress with `ship status <run-dir>`.

When the CLI isn't installed or built, fall back to the v0.1 prompt-only path: everything
above still happens, just orchestrated directly in this conversation (subagents, `git`
worktrees by hand, manual state tracking for LARGE work per `references/task-contract.md`).
Never block on the CLI's absence — degrade to the prompt path and say so if it's relevant.

---

## 1. Understand — build the contract in your head

Turn the request into a compact task contract: **objective, acceptance criteria,
constraints, out of scope, subsystem, how it gets verified, risks**. Infer it from the
request and the repo. Never make the user write it.

- Infer aggressively, invent nothing. Do not add product requirements to make the task bigger.
- Ask the user only when a misreading would produce unsafe or useless work. Otherwise take
  the conservative reading, state it in one line, and proceed.
- Everything not asked for is out of scope. Fix that boundary before you start.

Format and persistence: `references/task-contract.md`.

## 2. Classify — size drives orchestration

Judge from the diff you expect, not the sentence you were given. Keep the class private
unless saying it helps the user.

**SMALL** — localized, low risk, roughly 3 files or fewer, no architecture decision.
→ `inspect → implement → targeted check → done`. No subagents, no plan document, no reviewer
— unless the change touches something dangerous (auth, money, data migration, concurrency),
in which case review it regardless of size.

**MEDIUM** — several related files, unfamiliar internals, behavioural change, real
regression risk.
→ `targeted recon → short plan → implement → targeted tests → independent review → fix confirmed findings`.

**LARGE** — multiple components, architectural consequence, migration, cross-package work,
or several independently testable workstreams.
→ `recon → explicit plan → dependency DAG → parallelize only genuinely independent nodes →
integrate → verify → review`. Persist contract and plan to a file so a fresh agent can resume.
When the goal spans more than one PR's worth of work, decompose into epics — independently
shippable slices — before the task DAG; see `references/task-contract.md`'s `## Epics`
section.

**VERY LARGE** — broad mechanical migration across many isolated units.
→ Same shape as LARGE, but hand the repeating unit to native batch/worktree mechanisms
instead of hand-rolling a fan-out of dozens of agents. See `references/parallelism.md`.

When torn between two classes, run the smaller one's workflow and escalate if recon proves
you wrong. Escalating is cheap. Over-orchestrating a small task is not.

## 3. Recon — targeted, once

Before changing non-trivial code, understand the area. Read `AGENTS.md` / `CLAUDE.md` first
if present, along with the repo's build and test config — you need its commands later anyway.

Navigate by search, not by reading: grep the symbol, follow imports and call sites, open the
nearest tests, find the analogous implementation that already solves this shape of problem.
That analogue is the highest-value artifact of recon — it hands you the conventions, the test
style, and the abstractions to reuse.

Never recursively read large parts of the repo. Never re-read a file you already understand.

**Explore subagent** — worth it when the answer needs a wide fan-out across files and you
only want the conclusion. Give it a narrow, bounded question. Ask for only: relevant file
paths, existing analogous patterns, architectural constraints, relevant tests, dependencies,
likely risks, unresolved unknowns. It must not implement. Use its conclusion only; never
carry its reasoning forward.

For a SMALL task, recon is usually one grep and one file. Do it inline.

## 4. Plan — only when it earns itself

Trivial work: no plan. Just do it.

Non-trivial work: a short plan before editing, covering only what matters — files likely to
change, existing abstractions to reuse, behavioural changes, data/API/schema implications,
test strategy, ordering and dependencies, top risks, and what must **not** change.

Apply YAGNI, KISS, DRY and SOLID pragmatically: the smallest correct implementation that fits
the repo's existing architecture. No abstraction for a hypothetical second caller. No
refactoring of adjacent code because it could be tidier. If the plan is longer than the diff
it describes, the plan is wrong.

Show the plan to the user for LARGE work, or when it contains a decision they would want to
overrule. Otherwise keep it short and keep moving.

## 5. Implement

Match the repo: its conventions, its abstractions, its architectural boundaries. Keep the
diff focused and minimal. Preserve backward compatibility unless breaking it is the task.
Inspect every call site before changing a shared interface. Update tests alongside
behavioural changes. Prefer explicit correctness over cleverness.

Never: add a dependency without justification, write a comment that restates the code,
rewrite unrelated code, silently pass over a failing check, or slip in a behavioural change
nobody asked for.

Parallel implementation agents are a last resort, not a default — see step 6. Long-form
rules: `references/workflow-rules.md`.

## 6. Parallelism — earn it or skip it

Multiple implementation agents only when all of these hold: the workstreams are genuinely
independent, ownership boundaries are clean, they share little mutable context, concurrency
saves meaningful time, and integration risk stays manageable.

Two agents editing the same files, or co-evolving the same API, is not parallelism. It is a
merge conflict with extra steps. Sequential is the right default, and preferring it when
parallelism would cost more in context and merging than it saves in wall-clock is the correct
call, not a failure of nerve.

When you do fan out: isolated git worktrees, one compact Work Contract per worker (objective,
its slice of the acceptance criteria, owned files, constraints, dependencies already settled,
commands to run, required output shape). Never hand a worker your conversation. Never make it
rediscover the repo you already mapped.

Contracts, dependency DAG, worktrees, integration: `references/parallelism.md`. For a
multi-epic goal, the same DAG applies one level up across epics — see that file's "Epics"
section.

## 7. Context discipline

Context is the budget you are spending. Concretely:

- Pass repo paths, not file contents. Pass summaries, not transcripts. Pass diffs, not whole files.
- Filter command output at the source: `pytest -q --tb=short`, `git diff --stat`,
  `git status --short`, `rg`, `tail`, `2>&1 | tail -50`. Read the failure, not the log.
- One agent maps an area; the others are told what it found. Never let two agents rediscover
  the same architecture.
- Fresh context is for independence (review), not for redundancy.
- Don't narrate. Progress prose costs tokens and tells the user nothing they can't already see.

Use the cheapest capable model for low-reasoning work — repo search, file discovery,
summarization, mechanical inspection — and save stronger reasoning for architecture, hard
implementation, debugging, security analysis, and ambiguous failures. Don't build elaborate
routing logic where the native default already picks sensibly.

## 8. Verify — deterministically

Never ask a model to infer what a command can prove. Discover commands from the repo
(`AGENTS.md`, package scripts, Makefile, task runner, CI config, docs) before inventing any.

Cheapest and highest-signal first; stop at the first failure and fix before continuing:

1. the nearest / targeted test
2. affected module or package tests
3. formatter / linter
4. type checker
5. build / compile
6. relevant integration tests
7. broader or full suite — only when the risk justifies the cost, and before final completion
   on risky work

If a check doesn't exist in this repo, say so rather than implying coverage you don't have.

## 9. Independent review

For anything non-trivial, a **fresh-context** reviewer looks at the change. You are not the
sole reviewer of your own work — you already believe it's correct, and that belief is the bug.

Use the `ship-reviewer` subagent. Give it only: objective, acceptance criteria, key
constraints, the diff (or changed-file paths), and relevant test results. Do not give it your
reasoning or your justification for the choices you made — reconstructing that independently
is exactly its job.

It returns prioritized findings (P0 catastrophic/data loss → P3 real maintainability
problems) or `PASS`. Severity ladder, finding format, and specialist routing:
`references/review-contract.md`.

**Specialist routing — only when the diff warrants it.** Add security-focused review when the
diff touches auth, authorization, secrets, crypto, user-controlled file handling, query
construction, shell/process execution, serialization or deserialization, network boundaries,
or permissions. Add performance-focused review when it touches hot request paths, query
loops, large collections, streaming, caching, concurrency, serialization, or batch
processing. Frontend changes deserve behavioural checking in a browser when browser tooling
is available, not just static reading — that's what `ship-verifier` is for.

## 10. Triage findings, then fix

Reviewer findings are hypotheses, not instructions. For each material one: inspect the
evidence, reproduce it or logically confirm it, mark it **confirmed** or **rejected**, and fix
only the confirmed ones. A finding that contradicts the acceptance criteria or the repo's
architecture gets rejected with a one-line reason — the reviewer being wrong is a normal
outcome, not a thing to accommodate.

Fix with the main agent unless isolation clearly argues otherwise. Re-run the smallest
verification that covers the fix.

One extra review pass is fine if the fixes materially changed behaviour. Beyond that, stop.
Cycling agents over subjective suggestions is how a finished change becomes unfinished.

## 10.5. Review → adapt → PR, per epic (multi-epic goals only)

Single-epic and SMALL/MEDIUM work: skip this, go straight to step 11.

For a goal decomposed into epics, steps 8–10 above run once per epic against that epic's
integrated branch, not once for the whole goal. Once an epic's review passes, prepare (and,
only if asked, open) its PR rather than waiting for every epic to finish. Loop, tracker
fields, and PR-description format: `references/pr-strategy.md`.

## 11. Completion gate

Code written is not work done. Before claiming success — per epic for multi-epic work, and
once more for the overall goal once every epic is `landed`, with the broader suite run on the
integration branch (opened PRs prove nothing about the union; see `references/pr-strategy.md`):

- acceptance criteria met, or explicitly listed as unverified
- the deterministic checks you ran actually passed
- confirmed findings resolved; no known P0/P1 outstanding
- the diff is still focused — nothing unrelated rode along

Then report, briefly:
- what changed, and where if that helps
- design decisions only when non-obvious or hard to reverse
- checks actually run, and their results
- unresolved risks or anything left unverified

Never claim a test passed unless you ran it and saw it pass. "I didn't run the integration
suite" is a fine thing to say; implying you did is not.

## Regression learning

When you find a real defect during the work, prefer `bug → regression test → fix` over
`bug → fix`. If the defect represents a rule rather than a single case, prefer an executable
invariant (a lint rule, an architecture test) over a paragraph of prose in a doc. Don't amend
repo-wide policy for a one-off mistake, and don't rewrite the repo's agent documentation
unless the user asked for that.

## Recovery

The workflow restarts from repository state, not from this conversation. For LARGE work,
persist the contract and plan to a file so a fresh agent can resume from git state + that
file + the repo docs + prior workers' compact output. Prefer durable artifacts over
remembered context. For a multi-epic goal, the same file's `## Epics` table is the resume
point for which epics are done, in progress, or not started — trust git state over it, same as
the task-level `## State` section.
