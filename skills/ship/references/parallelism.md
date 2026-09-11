# Parallelism

Read this only when you are seriously considering more than one implementation agent. If you
haven't yet asked "would sequential be simpler?", ask that first — it usually is.

## The test

Fan out only when **every** one of these holds:

1. **Genuine independence.** The workstreams don't need each other's output. If B waits on A,
   that's a sequence, not a fan-out.
2. **Clean ownership.** Each worker owns a disjoint set of files. Overlap means conflicts.
3. **Little shared mutable context.** They aren't co-evolving the same interface, schema, or
   config. If the shared type is still moving, nobody can build against it.
4. **Meaningful gain.** Enough work per worker that the coordination cost is worth it. Three
   five-minute edits are faster done in a row.
5. **Manageable integration.** You can state, in advance, how the branches merge and what you
   run afterward.

Fail any one → sequential.

## When it clearly does not apply

- Refactoring a core model used throughout the system. Everything depends on the same shape;
  parallel workers will each invent a different one. Do the architecture first, land the core
  change, then fan out the mechanical call-site updates only if there are many.
- Any change where the interface is the deliverable. Settle it in one place, then parallelize
  the implementations against the settled interface.
- Small or medium tasks. The context of briefing a worker exceeds the work.

## When it clearly does apply

- N independent adapters, plugins, packages, or services migrating from V1 to V2 of an
  interface that is already frozen.
- Independent bug fixes in unrelated subsystems.
- A mechanical codemod across packages with no shared state, where each package has its own
  tests.

For the mechanical N-unit case: do **one unit yourself first**. That first unit is the
template — it proves the migration works, exposes the surprises, and becomes the worked
example every worker gets. Fanning out before you've done one is how you get N different
wrong answers.

## Dependency DAG

For LARGE work, write the nodes and their edges before doing anything:

```
A: freeze V2 interface + migrate adapter #1 as reference   (no deps)
B: adapters 2–7                                            (deps: A)
C: adapters 8–13                                           (deps: A)
D: adapters 14–18                                          (deps: A)
E: remove V1 shim + update docs                            (deps: B, C, D)
```

Execute only nodes whose dependencies are complete. Nodes at the same level with no shared
files may run in parallel. When in doubt about an edge, add it — a false dependency costs
wall-clock; a missing one costs correctness.

Keep the DAG in the persisted plan so a fresh agent can pick up where you stopped.

## Work Contract

Each worker gets exactly this, and nothing else:

```markdown
## Objective
Migrate the adapters listed below from ProviderV1 to ProviderV2.

## Acceptance criteria (your slice)
- Each adapter implements ProviderV2 as defined in src/providers/v2.ts:1-58.
- Existing behaviour unchanged; each adapter's own tests pass.
- No changes outside the files you own.

## You own
src/adapters/stripe/**, src/adapters/paypal/**, tests for those adapters.

## Already established (do not redo, do not change)
- V2 interface is frozen at src/providers/v2.ts.
- Reference migration: src/adapters/square/ — follow its structure exactly.
- Error mapping helper lives at src/providers/errors.ts; reuse it.

## Verify
npm test -- src/adapters/stripe src/adapters/paypal
npm run lint -- src/adapters/stripe src/adapters/paypal

## Return
- files changed (paths)
- 2–4 sentences on what you did
- decisions that deviate from the reference migration, with reason
- verification: command → result
- failures, risks, anything you could not complete
- branch / worktree name
```

Never hand a worker the parent conversation. Never make it rediscover architecture you
already mapped — the "Already established" block is what buys back the tokens each worker
would otherwise spend re-exploring.

## Worker output

Compact and structured, as specified above. If a worker returns a transcript, extract the
facts and drop the rest before it enters your context. What you carry forward is: paths
changed, decisions, verification results, unresolved problems.

## Worktrees

Use isolated git worktrees when workers run concurrently against the same repo. Skip them
entirely for sequential work — a worktree for a task nobody is racing is pure overhead.

Rules that prevent the usual failures:

- Every worktree branches from the same known base commit. Record it.
- Ownership boundaries are file-level and disjoint. Two worktrees editing one file will merge
  badly, and you'll debug it instead of them.
- Integrate deliberately, one branch at a time, and run the affected tests after **each**
  merge, not only after the last one. The failure you want to catch is the one caused by
  combining two individually-correct changes.
- After all merges: run the broader suite once against the integrated tree. Individual worker
  passes prove nothing about the union.
- Clean up worktrees when done.

Prefer the harness's native worktree/batch mechanisms over hand-rolled `git worktree`
plumbing where they exist. For a VERY LARGE mechanical migration, native batch execution over
a list of units beats orchestrating dozens of agents by hand — you get the isolation and the
throughput without owning the coordination code.

## Integration

1. Merge in dependency order.
2. Run affected tests after each merge.
3. Reconcile duplicated work — two workers solving the same sub-problem in two ways is common;
   pick one and unify before moving on.
4. Full relevant suite on the integrated tree.
5. Review the **integrated** diff, not the individual worker diffs. Bugs live in the seams.
