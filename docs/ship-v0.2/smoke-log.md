# Ship v0.2 live smoke log

Recorded runs of `packages/cli` against a real worker process — the one thing the
unit/fixture test suite cannot prove on its own, since this development sandbox blocks
spawning a nested `claude`/`codex` process. Every run below was executed by the user, outside
that sandbox, on their own machine (Windows 11).

## Claude host / Claude worker — single small task

- **Command:** `ship-cli run .\run1 .\tasks.json` against a one-task graph (`hello`, no
  dependencies) in a scratch git repo, objective: create `hello.txt` with specific content.
- **Result (final, successful attempt):** `hello: integrated`. `git show ship/run1/hello:hello.txt`
  returns the exact requested content; `headCommit` in `state.json` differs from `baseCommit`,
  confirming a real commit landed.
- **Runtime:** claude-code 2.1.269, Sonnet.

This run went through four attempts before succeeding, each surfacing a real defect that unit
tests — which only ever exercised fake worker scripts — could not have caught:

1. **Spawn failure (every attempt failed instantly, `pid: -1`).** npm installs `claude`/`codex`
   on Windows as `.cmd` shims; `child_process.spawn()` without a shell can't execute them.
   Fixed in `packages/cli/src/adapters/windows-shim.ts`: resolve the shim to the real `.exe`
   it wraps and spawn that directly (not `shell: true`, which Node's own `DEP0190` flags as
   unsafe with an argument array).
2. **Stale worktree registration.** Manually deleting a run directory (`rm -rf`) without
   `git worktree remove` first left git's own registry pointing at a missing path; the next
   attempt's `git worktree add` refused to proceed. Fixed with a `git worktree prune` step in
   `createOrAdoptWorktree` (git.ts).
3. **Silent false pass.** The worker replied with `defaultBriefing`'s literal example JSON
   (empty `changedPaths`, no blockers) instead of doing the task; the task was still marked
   `integrated` with `baseCommit === headCommit`. Fixed two things: `git.ts`'s `verify()` had
   never actually received the `WorkerResult` parameter (silently dropped), so nothing could
   check the claim against reality — now it does, and rejects "no commit, no blocker" as
   unproven; and `run.ts`'s `defaultBriefing` was rewritten to stop reading like something to
   echo back verbatim.
4. **Uncommitted-but-correct work marked as if it were nothing.** With the wording fixed, the
   worker did create the right file with the right content — but never ran `git commit`. Ship
   now captures any uncommitted work in the task's worktree itself
   (`commitAnyPendingWork` in git.ts) rather than depending on the worker to remember.

All four fixes shipped with regression tests against real temporary git repos (not mocks);
see the commit history on this branch for details.

## Claude host / Codex worker

**Not run.** No live smoke evidence yet for the Codex adapter; only the fixture-based test
suite (`packages/cli/src/adapters/codex.test.ts`) has exercised it.

## Whole-goal run with a manual task

**Not run.** No live smoke evidence yet for a multi-task medium/large plan or a manual task.
