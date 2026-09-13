# Task Contract

The contract is the compressed form of the request that survives context loss. For SMALL and
MEDIUM work it lives in your head and appears only as a one-line assumption to the user. For
LARGE work, write it to a file so a fresh agent can resume without this conversation.

## Fields

| Field | What goes in it |
|---|---|
| `objective` | One sentence. The behaviour change the user wants, not the implementation. |
| `acceptance_criteria` | 2–6 observable statements. Each must be checkable by a test, a command, or direct inspection. |
| `constraints` | Compatibility promises, performance budgets, API stability, security requirements, repo conventions that bind this change. |
| `out_of_scope` | What you will deliberately not touch. Guards against scope creep and against a reviewer demanding it. |
| `subsystem` | Paths / packages / components involved, once recon has told you. |
| `verification` | The exact commands that prove the criteria — discovered from the repo, not invented. |
| `risks` | Known unknowns, dangerous interactions, things you're assuming. |

## Inference rules

**Infer from the request and the repo. Never make the user fill in a form.**

- Acceptance criteria come from the request's verbs plus the repo's existing behaviour. "Add
  pagination to the users API using existing conventions" yields criteria about the shape of
  the response, the parameter names, the default page size, and backward compatibility for
  callers that pass nothing — all readable from the analogous endpoint.
- Constraints come from what already exists. If every other endpoint returns
  `{items, next_cursor}`, that's a constraint, not a design choice you get to make.
- Out of scope defaults to "everything not named". Write it down when adjacent code is
  tempting.
- Risks are for real ones: shared interfaces with many call sites, data migrations,
  concurrency, anything touching auth or money.

**Never invent product requirements to make the task larger.** If the user asked for
rotation, they did not ask for rotation plus revocation plus an admin endpoint. Mention an
adjacent gap in one line at the end; don't build it.

## When to ask the user

Ask only when proceeding under any assumption would be unsafe, or would make the work useless
if the assumption is wrong. Examples that justify asking: an irreversible data migration with
two plausible target shapes; a security control where the wrong reading weakens it; an API
change where both readings break a different set of callers.

Everything else: take the conservative reading, say which one you took in a single line, and
proceed. Do the parts that don't depend on the ambiguity first, regardless.

## Persisting (LARGE only)

Write it as markdown to a scratch path outside the repo (or a path the user names). Keep it
under a page. Add a `state` section that a resuming agent can trust:

```markdown
## State
- Done: <node ids / short descriptions>
- In progress: <node>, worktree <path>, branch <name>
- Not started: <nodes>
- Verification last run: <command> → <result>
```

Update it when a node completes, not continuously. It is a resume point, not a log.

## Epics (multi-epic goals only)

When a goal is decomposed into epics — independently shippable slices, each its own eventual
PR — add an `## Epics` section to the same persisted file, above the state sections, and
namespace each active epic's task state as its own `## State: <id>` section so parallel epics
don't overwrite each other's resume data:

```markdown
## Epics
Integration branch: ship/<goal-slug>   base: <commit>

| id | goal | depends_on | status | branch | tasks |
|---|---|---|---|---|---|
| E1 | ... | — | done | ship/e1-... | T1,T2 |
| E2 | ... | E1 | in-review | ship/e2-... | T3,T4,T5 |
| E3 | ... | E1 | in-progress | ship/e3-... | T6 |

## State: E2
- Done: T3, T4
- In progress: T5, worktree <path>, branch <name>
- Verification last run: <command> → <result>

## State: E3
...
```

Status values: `not-started → in-progress → verifying → in-review → landed → ready-for-pr → done`.
Epics follow the same dependency-DAG rules as task nodes (`references/parallelism.md`) — a
dependency is satisfied at `landed` (merged into the local integration branch), never by
publication, so an epic whose `depends_on` are all `landed` or later is on the frontier and
eligible to start; epics on the same frontier with disjoint files may run in parallel. Update
the table on epic transitions only, same as `## State`. Drop an epic's `## State: <id>` section
once it's `landed`. Branch layout, per-epic review/fix/land/PR loop, and the final cross-epic
gate: `references/pr-strategy.md`.

Don't add this section for single-epic or SMALL/MEDIUM work — it's overhead with nothing to
track.

## Resuming from one

A fresh agent reconstructs from, in order: current git state (`git status --short`,
`git diff --stat`, branch and worktree list), the persisted contract and plan, the repo's
`AGENTS.md`, the last recorded verification result. Re-run the cheapest check to confirm the
recorded state is still true before continuing — the file is a claim, git is the fact.
