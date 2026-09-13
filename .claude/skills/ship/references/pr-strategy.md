# Review → adapt → PR (per epic)

Read this once a goal has been decomposed into epics (`references/task-contract.md`'s
`## Epics` tracker) and one epic's tasks are integrated on its branch. This is the same
review/triage/fix loop from steps 9–10 of `SKILL.md`, scoped to one epic's diff instead of the
whole request, plus one new final step: get that slice into a mergeable state.

Skip this file entirely for SMALL/MEDIUM work, or LARGE work with a single epic — just run
steps 9–11 once, as today.

## Why per epic, not once at the end

A goal with several epics produces one enormous diff if review waits for all of them. Reviewing
and shipping each epic as it lands keeps review scope small, catches integration problems
before they compound across epics, and lets the user merge partial progress instead of an
all-or-nothing drop.

## Branch layout

One local integration branch for the goal (`ship/<goal-slug>`), cut from the base commit and
recorded in the tracker. Every epic branch forks from the integration branch at the moment it
starts — so a dependent epic automatically inherits its dependencies' landed code. Nothing here
is pushed; the integration branch is a local verification surface.

A dependency is satisfied when the epic reaches `landed` (merged into the integration branch,
below). Publication (`ready-for-pr`, `done`) never gates successors.

## The loop, per epic

1. **Integrate.** Merge the epic's task nodes onto the epic's branch in dependency order (same
   rules as `parallelism.md`'s Integration section). Run the affected tests after each merge.
2. **Verify.** Run the epic's own deterministic verification (step 8) against the integrated
   epic branch — not the individual task worktrees.
3. **Review.** Dispatch `ship-reviewer` against the epic's diff, scoped to that epic's objective
   and acceptance criteria only (step 9, unchanged — same subagent, same briefing rules).
4. **Adapt.** Triage findings and fix (step 10, unchanged), confirmed findings only, re-verify
   the smallest check that covers the fix.
5. **Land.** Merge the epic branch into the integration branch; run the affected tests against
   the integrated tree (the seam between epics is where combined-but-individually-correct
   changes break — same rule as `parallelism.md`). Mark the epic `landed`. Dependent epics may
   now start.
6. **Prepare the PR.** Write a PR description from the epic's row in the task contract:
   objective, its slice of the acceptance criteria, files touched, verification commands and
   results, any findings fixed. Save it next to the tracker file (e.g. `<epic-id>-pr.md`).
   Mark the epic `ready-for-pr`. PR base is whatever the epic branch forked from: `main` for a
   root epic, the dependency's branch for a stacked one — so PRs merge upstream in dependency
   order.
7. **Open the PR — only when asked.** Writing the description and marking the branch ready is
   as far as this goes by default. Opening a real PR (`gh pr create`, or pushing the branch) is
   a risky, externally-visible action per the workflow's existing rules: confirm with the user
   first, unless they've already said to open PRs as epics complete. Use the generated
   description as the PR body verbatim; don't re-derive it.
   - No GitHub issue/tracker wiring here. Local files are the tracker. `gh` integration (linking
     epics to GitHub issues, syncing status) is a deliberate later step, not part of this loop.
8. Mark the epic `done` once its PR is opened (or, if the user isn't using PRs, once the user
   has merged its branch).

## Final gate across epics

Opening PRs proves nothing about the union. Before claiming the overall goal complete (step
11), run the broader / full relevant suite once on the integration branch with every epic
landed. A PR that's already open can still be wrong; fix on the epic branch and re-land.

## What doesn't change

- Work Contracts, worktrees, subagent dispatch: identical to `parallelism.md`. An epic is a
  grouping for tracking and review scope, not a new execution mechanism.
- The reviewer subagent, its briefing, and the severity ladder: identical to
  `references/review-contract.md`.
- The overall goal still gets one final completion-gate pass (step 11) once every epic is
  `done`, confirming nothing fell through the cracks between epics.
