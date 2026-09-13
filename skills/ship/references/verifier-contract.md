# Verifier Contract

Planning a check and executing it are separate responsibilities (plan §5). This document is
the capability-aware model both `ship-verifier` (agent-driven verification) and the CLI's
`src/capabilities.ts` / `src/verify.ts` (command-driven verification) follow, so a check means
the same thing whether a human, an agent, or the CLI ran it.

## Check types

- **unit / static** — the nearest test, a linter, a type checker.
- **integration** — a broader test that exercises real interfaces.
- **browser (scripted)** — a Playwright/browser-tool script driving the running app.
- **interactive / visual** — a human or an agent with real browser tooling actually looks.
- **manual** — a human runs it and records the evidence; nothing here executes it.

## Capability routing, not runtime name

"Claude" does not prove browser access; "Codex" does not prove its absence. Match a check's
required capabilities (`browser`, `bash`, a specific binary) against a verifier's *probed*
capabilities (`available | unavailable | unknown`) — never against which runtime it is.
`unknown` never satisfies a requirement: a parent session having a browser doesn't prove the
launched child does, so an unprobed or ambiguous capability blocks exactly like an absent one.

Preflight in the context the check will actually run in: a port must be free, a URL must
answer, a binary must resolve — checked there, not inherited from the parent process. Allocate
ports/fixtures per parallel check and serialize access to anything shared, so two concurrent
checks never race the same resource.

## Evidence

Every check produces a record naming: the acceptance criterion it claims to satisfy, the
command (or interaction) and working directory, the commit it ran against, exit status or
observed behavior, and any log/screenshot path. A check that didn't run — missing capability,
never reached, blocked upstream — is recorded as not-run, distinctly from a check that ran and
failed. Evidence is scoped to the commit it tested; a fix needs new evidence, not a rerun of
stale evidence.

## Failure classes

- **assertion** — the check ran and the thing it asserts is false. Never retried to green.
- **environment** — an identified transient infrastructure failure (a flaky port bind, a
  network blip). At most two automatic retries, and only for this class; the original failure
  is preserved alongside any retry evidence.
- **missing_capability** — no verifier had what the check needed. The task stays at
  `implemented`; dependents wait. This is a blocker to resolve (add the capability, or a scope
  decision), not a failure to paper over.
- **unexecuted** — manual, or no runner was ever wired up.

One class of evidence never substitutes for another: a green unit suite cannot satisfy a
browser criterion, and a statically-reviewed diff is not a behaviorally-verified one. Say
"statically reviewed, behaviorally unverified" rather than implying more than what ran.

## What a verifier receives and returns

Same shape as review (`references/review-contract.md`), verification-flavored: acceptance
criteria, the diff or changed files, and how to run things. A verifier exercises and reports —
it never edits source (`ship-verifier`'s own constraints are stricter and behavioral; see
`skills/ship/agents/ship-verifier.md`). It returns the evidence above, organized by criterion:
verified, failed, or not verified, plus the commands actually run.

## No capable verifier

Block and ask for the capability or a scope decision. Human verification counts only when
explicitly recorded as such. Never substitute a weaker check for a required one to avoid
blocking.
