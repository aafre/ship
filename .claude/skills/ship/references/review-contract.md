# Review Contract

Independent review exists to catch what the implementer cannot see. That only works if the
reviewer's context is genuinely fresh and deliberately narrow.

## What the reviewer gets

Exactly this, nothing more:

1. **Objective** — one sentence.
2. **Acceptance criteria** — the observable statements from the task contract.
3. **Key constraints** — compatibility promises, security requirements, what must not change.
4. **Out of scope** — so it doesn't file findings demanding work the user excluded.
5. **The change** — `git diff` output, or changed-file paths plus the diff for each. Prefer
   the diff; it's smaller than the files and shows intent.
6. **Verification results** — which commands ran and what they said. Filtered, not raw logs.

## What it must NOT get

- Your reasoning, your design rationale, your defence of a choice. If the reviewer has to
  independently arrive at "this is fine", that's the signal you're paying for. Hand it your
  justification and it will simply agree with you.
- Your conversation transcript.
- The Explore agent's output, unless a specific architectural constraint is needed to judge
  the diff — in which case state that constraint in one line under "constraints".
- Whole files where a diff would do.

## Severity ladder

**P0 — must fix.** Catastrophic correctness failure, data loss or corruption, severe runtime
failure (crash on a normal path, unbounded resource growth, deadlock).

**P1 — must fix.** Security vulnerability, a stated requirement not actually met, a major
behavioural regression, invalid data accepted or valid data rejected.

**P2 — should fix.** Unhandled edge cases, concurrency / retry / idempotency defects, a
meaningfully missing test, a real performance problem, a backward-compatibility break that
wasn't intended.

**P3 — consider.** Maintainability problems with concrete cost: duplicated logic that will
drift, an abstraction that hides a correctness-relevant detail, naming that actively misleads.

**Not a finding.** Style preferences, formatting the repo's own formatter doesn't enforce,
"you could also", alternative architectures that are merely different, or anything the task
contract lists as out of scope. Subjective nitpicks make findings expensive to triage and
train the implementer to skim them.

If nothing material is found, the reviewer returns exactly `PASS` plus at most one line of
context. An empty finding list is a good outcome, not a failed review.

## Finding format

```
[P1] path/to/file.py:142 — Refresh token is not invalidated on rotation
Problem: rotate() issues a new token but leaves the old row's revoked_at NULL, so the
  previous token stays valid until natural expiry.
Evidence: token_service.py:142 sets new row; no update to the old row. No test covers
  reuse of a rotated token.
Verify: call rotate(), then authenticate with the pre-rotation token — it succeeds.
Fix direction: mark the consumed token revoked inside the same transaction as the insert.
```

Every finding needs: severity, location, the concrete problem, the evidence for it, a way to
verify or reproduce it where one exists, and a fix *direction* — not a patch. The implementer
decides the fix; the reviewer identifies the defect.

## Triage — for the implementing agent

Findings are hypotheses. Treat each material one as a claim to test:

1. **Inspect the evidence** at the cited location. Does it say what the reviewer says it says?
2. **Reproduce or logically confirm.** A P0/P1 that can be reproduced should be, with the
   smallest possible check. A reviewer's "Verify:" line is the cheapest place to start.
3. **Classify**: confirmed or rejected.
4. **Fix confirmed findings only.** Smallest correct fix; same rules as any implementation.
5. **Re-run the narrowest verification** that covers the fix. Not the whole suite.

Reject with a one-line reason when a finding:
- contradicts an acceptance criterion (the user asked for exactly this behaviour),
- contradicts the repo's established architecture,
- demands work the contract puts out of scope,
- is a style preference dressed as a defect,
- or rests on a misreading of the code you can point to.

Record rejections briefly. If the user later asks "did the reviewer flag anything", the
answer includes what you rejected and why.

Do not run more than one extra review pass, and only run that one if the fixes materially
changed behaviour. A second pass on cosmetic fixes is theatre.

## Specialist routing

Route by what the diff touches, not by task size.

**Security review** — auth, authorization, session/token handling, secrets, crypto,
user-controlled file paths or uploads, SQL or other query construction, shell/process
execution, deserialization, network boundaries, permission checks. Ask specifically about:
bypass paths, missing invalidation, TOCTOU, injection surfaces, secrets in logs or errors,
and whether the control fails closed.

**Performance review** — hot request paths, queries inside loops, unbounded collections,
streaming, caching, concurrency, serialization, batch processing. Ask about: complexity
change, N+1 queries, allocation in hot loops, lock contention, and whether a claimed
improvement was measured.

**Behavioural verification** — frontend and UX changes. Static review cannot tell you a
button works. Use `ship-verifier` with browser tooling when it's available; when it isn't,
say the change is statically reviewed and behaviourally unverified rather than implying
otherwise.

One specialist, when warranted. Not all three on every diff.
