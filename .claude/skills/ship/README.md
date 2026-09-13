# ship

A disciplined engineering workflow as a Claude Agent Skill. You make an ordinary request —
"add refresh-token rotation", "fix the race in the ingestion worker" — and the skill picks and
runs the right workflow: recon, plan when it's worth one, implement, verify with real
commands, get an independent review, validate the findings, fix, re-verify, report with
evidence.

You talk to one agent. Subagents, worktrees, plans, contracts, and review happen underneath.

## Install

Any agent the [`skills` CLI](https://github.com/vercel-labs/skills) supports:

```bash
npx skills add aafre/ship        # -g for every project, -a <agent> for one agent
```

Claude Code as a plugin (also registers the subagents): `/plugin marketplace add aafre/ship`,
then `/plugin install ship@ship` (command becomes `/ship:ship`).

By hand, copy this directory to wherever your agent discovers skills (`.claude/skills/`,
`.agents/skills/`, `~/.claude/skills/`, …). Claude Code users also copy `agents/*.md` to
`.claude/agents/` for native `ship-reviewer` / `ship-verifier` subagents; other hosts run the
same role prompts in a fresh session (SKILL.md step 9 says how).

Nothing else to configure. The skill discovers each repo's own build/test commands rather
than assuming a language or toolchain, so it's portable as-is. Verified loading: Claude Code,
Codex, OpenCode, Pi (`-g`); the root README's "Which agents" table has the full tiering.

## Triggering

**Automatic** on substantive code-change requests: features, bug fixes, refactors,
migrations, performance work, API and schema changes, test work, reliability and
security-sensitive changes, "implement this issue".

**Explicit**: `/ship <request>`.

**Deliberately does not trigger** on questions about code, explanations, brainstorming,
code-reading with no modification, or one-line edits where the workflow would cost more than
it returns. If it does fire on something trivial, it collapses to inspect → edit → check,
which is what you'd have done anyway.

## Workflow by size

The skill classifies the task privately and orchestrates to match.

| Class | Shape | Workflow |
|---|---|---|
| **SMALL** | localized, low risk, ≲3 files | inspect → implement → targeted check. No subagents, no plan, no reviewer — unless it touches auth, money, migrations, or concurrency. |
| **MEDIUM** | several files, behavioural change, real regression risk | targeted recon → short plan → implement → targeted tests → independent review → fix confirmed findings. |
| **LARGE** | multiple components, architectural consequence, migration | recon → explicit plan → dependency DAG → parallelize only independent nodes → integrate → verify → review. Contract and plan persisted for resumability. |
| **VERY LARGE** | broad mechanical migration, many isolated units | same shape, but the repeating unit goes to native batch/worktree execution rather than a hand-rolled fan-out of dozens of agents. |

Ambiguous cases run the smaller workflow and escalate if recon proves it wrong.

## Subagents

Three, used conditionally:

- **Explore** (built-in) — wide fan-out search when you need a conclusion, not files. Narrow
  bounded question, compact answer: paths, analogous patterns, constraints, tests,
  dependencies, risks, unknowns. Never implements.
- **ship-reviewer** — fresh-context reviewer for non-trivial changes. Receives objective,
  acceptance criteria, constraints, diff, and test results — deliberately *not* the
  implementer's reasoning, since independently reconstructing correctness is the point.
  Returns P0–P3 findings with evidence and a reproduction, or `PASS`.
- **ship-verifier** — behavioural verification. Runs the repo's real commands, or drives the
  UI in a browser, and reports what actually happened. Used when "it reads correctly" isn't
  sufficient evidence.

Specialist review (security, performance, browser) is routed by what the diff touches, not by
task size. One specialist when warranted, not three on every change.

Findings are treated as hypotheses: each material one is reproduced or logically confirmed
before any fix, and findings that contradict the acceptance criteria or the repo's
architecture are rejected with a reason.

## Worktrees

Only when multiple agents modify code concurrently. Each worker branches from a recorded
base, owns a disjoint file set, and gets a compact Work Contract (objective, its slice of the
criteria, owned files, established decisions, commands to run, required output). Integration
is deliberate: merge in dependency order, run affected tests after *each* merge, then review
the integrated diff — the seams are where the bugs are.

Sequential work gets no worktree.

## Context discipline

Context is treated as the scarce resource it is:

- paths instead of file contents, summaries instead of transcripts, diffs instead of files
- command output filtered at the source (`--tb=short`, `git diff --stat`, `| tail -40`)
- one agent maps an area; the others are told what it found
- fresh context for independence (review), never for redundancy
- no progress narration

## Verification

Never asks a model to infer what a command can prove. Commands are discovered from
`AGENTS.md`, package scripts, Makefile, task runner, or CI config — not invented from a file
extension. Runs cheapest-first and fails fast: nearest test → module tests → lint → types →
build → integration → full suite only when risk justifies it.

Completion requires evidence. A test is never reported as passing unless it ran and passed,
and anything unverified is named as unverified.

## Examples

```
/ship Add refresh-token rotation
/ship Fix the race condition in the ingestion worker
/ship Add pagination to the users API using the existing conventions
/ship Refactor the payment adapter without changing behaviour
/ship Migrate the 18 provider adapters from V1 to V2
/ship Implement GitHub issue #412
```

Bare requests without `/ship` trigger it too, when they're substantive code changes.

## Files

```
skills/ship/
  SKILL.md                        core workflow and decision logic
  README.md                       this file
  agents/
    ship-reviewer.md              independent fresh-context reviewer
    ship-verifier.md              behavioural verifier (commands + browser)
  references/
    task-contract.md              contract fields, inference rules, persistence, resuming
    review-contract.md            reviewer briefing, severity ladder, triage, specialist routing
    workflow-rules.md             implementation, verification, and completion detail
    parallelism.md                the fan-out test, DAG, work contracts, worktrees, integration
    verifier-contract.md          capability-aware verification, evidence, failure classes
    pr-strategy.md                per-epic review → PR loop
```

References load only when the relevant phase needs them, so a SMALL task costs SKILL.md and
nothing else.
