# Workflow Rules

Long-form detail for implementation, verification, and completion. Read when you're in those
phases and want the specifics, not before.

## Implementation

### Fit the repo before improving it

The strongest signal available is the analogous implementation already in the tree. Before
writing anything, find the closest existing case of the same shape — the other paginated
endpoint, the other adapter, the other migration — and copy its structure, naming, error
handling, and test style. A change that reads like the surrounding code is reviewable; a
change that reads like a different codebase is not, regardless of its merits.

Reuse before you write. A helper, a validator, a type, a base class that already exists a few
files over is almost always the right answer. Re-implementing what the repo already has is the
most common failure mode in agent-written code.

### Diff hygiene

- Focused. Every hunk traces to an acceptance criterion or a confirmed finding.
- Minimal. The smallest correct implementation, not the most complete one.
- No drive-by refactors. Adjacent code that could be tidier stays untidy — note it in one
  line at the end if it genuinely matters.
- No formatting churn. If the repo has a formatter, run it; don't hand-reflow unrelated lines.
- Check the diff before you claim done: `git diff --stat` for shape, `git status --short` for
  strays. Files you didn't mean to touch are a signal, not noise.

### Shared interfaces

Before changing any signature, type, schema, or config key that others consume: grep every
call site and read them. Two questions decide the change — does every caller still compile,
and does every caller still *mean* the same thing? The second one is where the bugs are.

Preserve backward compatibility unless breaking it is the task. When a break is required and
sanctioned, make it loud (a version bump, a deprecation, a migration) rather than silent.

### Root cause, not symptom

A bug report names a symptom. Before editing the reported path, check whether its siblings
route through the same defect. One guard in the shared function is a smaller diff than a
guard in each caller — and it fixes the callers nobody filed a ticket for.

### Restraint list

Never do these without being asked:

- add a dependency (justify it, or write the few lines yourself)
- introduce an abstraction with one implementation
- add configuration for a value that never changes
- generalize for a hypothetical second use case
- write a comment that restates the line below it
- change behaviour that nobody asked to change
- rewrite unrelated code
- silently continue past a failing check

### Tests alongside behaviour

Behavioural change means test change, in the same diff. New behaviour gets a test that fails
without the change. A fixed bug gets a regression test that reproduces the original failure.
Follow the repo's existing test conventions — location, naming, fixtures, assertion style —
rather than importing your own.

If the repo has no test framework at all, say so and leave the smallest runnable check that
fails if the logic breaks. Don't install a framework to make a point.

## Verification

### Discover, don't invent

Look for commands in this order and stop when you find them: `AGENTS.md` / `CLAUDE.md`,
package manifest scripts (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` tooling,
`composer.json`), `Makefile` / `justfile` / `Taskfile`, CI config (`.github/workflows/`,
`.gitlab-ci.yml`), the README's contributing section. Use what CI uses — that's the
definition of passing in this repo.

Do not assume a language ecosystem. Do not run `pytest` because the file ends in `.py` if the
repo drives tests through `make test`, `tox`, `nox`, or a runner script.

### Order and fail-fast

Run cheap, high-signal checks first, and stop at the first failure:

1. **Nearest test** — the single test file or test case covering what you changed. Seconds.
2. **Module / package tests** — the surrounding suite.
3. **Formatter / linter** — repo's own, in its own configured mode.
4. **Type checker** — if the repo has one.
5. **Build / compile** — if there is a build step.
6. **Integration tests** — the relevant ones, when the change crosses a boundary.
7. **Full suite** — only when risk justifies the cost, and before final completion on risky
   work (auth, data, migrations, shared interfaces, concurrency).

Fixing a failure at step 1 before running step 6 is not optional — running an expensive suite
against a known-broken tree burns time and produces output you'll have to filter anyway.

### Output filtering

Large output is a context leak. Filter at the source:

```
pytest -q --tb=short                    # not -v, not full tracebacks
npm test 2>&1 | tail -40
go test ./... 2>&1 | tail -40
cargo test 2>&1 | tail -30
make check 2>&1 | tail -50
git diff --stat
git status --short
rg -n 'pattern' --glob '!**/node_modules/**'
```

When a suite fails, read the *first* failure in detail and ignore the cascade. When output is
genuinely large and needed, redirect to a task-specific scratch file and inspect it rather
than reading it all in. For Go, retain the complete output: filtering only `---`, `FAIL`,
and `ok` lines discards compiler errors and panic details. The Go example uses a unique
scratch file and reports both the command's status and where to inspect its full output.

### Honest coverage

If a check doesn't exist in this repo, say that. "There is no type checker configured" is
information. Implying you type-checked is a defect in the report, and reports are part of the
deliverable.

## Completion

### Gate

Do not report success until all four hold:

- Every acceptance criterion is met, or is explicitly named as unverified with the reason.
- The deterministic checks you ran passed — actually ran, actually passed.
- Confirmed reviewer findings are resolved. No known P0 or P1 outstanding.
- The diff is still focused. Nothing unrelated rode along.

### Report shape

Short. The user reads this to decide whether to trust the change and what to do next.

```
<What changed, 1–3 sentences. Paths where they help.>

Checks: <command> → <result>, <command> → <result>
<Design decision, only if non-obvious or hard to reverse.>
<Unverified / risk, only if real.>
```

Omit any line that has nothing to say. No phase-by-phase narration, no recap of the
orchestration, no list of the subagents you used unless the user asked. The user cares about
the change and the evidence.

### Honesty rules

- Never claim a test passed unless it ran and passed in this session.
- If something is unverified, name it as unverified rather than omitting it.
- If part of the scope turned out blocked, finish everything else and say plainly what you
  left out and why. Scaling the work down is the user's call, not yours.
- If the reviewer flagged something you rejected, and it was material, mention it in one line.
