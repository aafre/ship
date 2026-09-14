# ship

**Give your coding agent a workflow for making changes, checking them, and reviewing the diff.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: early](https://img.shields.io/badge/status-early-yellow)](#project-status)
[![Agent Skills](https://img.shields.io/badge/format-Agent%20Skills-blue)](https://agentskills.io/specification)

ship is an agent skill that scales the workflow to the task: a small fix gets a targeted
check; substantive changes get planning when needed, verification, and fresh-context review
when the host supports it.

- **Less orchestration to manage.** The agent sizes the work and chooses the steps.
- **Checks grounded in your repo.** It discovers your test, lint, and build commands.
- **A report you can inspect.** What changed, what ran, review findings, and what remains unverified.

### What a completion report looks like

Illustrative example — not a captured run or benchmark:

```text
Request: Add cursor pagination to the users API

Changed: GET /users now accepts a cursor, reusing the /orders pattern.
Checks:  pytest -q tests/api/test_users.py → 14 passed
         ruff check src/ → clean
         mypy src/api → clean
Review:  Missing limit=0 test found; confirmed, fixed, and re-checked.
Pending: Integration suite needs a live database; not run.
```

[Get started](#quickstart) · [Compatibility](#which-agents) · [Workflow](#how-it-works) · [Evidence and limits](#project-status) · [Contribute](#contributing)

## Quickstart

You need a coding agent that supports skills, plus Node.js/npm for the installer.
From the project where you want to use ship:

```bash
npx skills add aafre/ship
```

Follow the installer prompts to select your agent. Then ask your agent:

```text
Use the ship skill to add cursor pagination to the users API.
```

The skill is designed to trigger on substantive engineering requests. Explicitly naming
it makes the first try easier to verify. Start with a small change whose checks you can run.
See [compatibility](#which-agents) for the difference between installing, loading, and running it.

<details>
<summary>Claude Code plugin — includes registered reviewer and verifier agents</summary>

Run inside Claude Code:

```text
/plugin marketplace add aafre/ship
/plugin install ship@ship
/ship:ship Add cursor pagination to the users API
```

Use this route for the native `ship-reviewer` and `ship-verifier` subagents.

</details>

<details>
<summary>Install for one agent, globally, or by hand</summary>

```bash
npx skills add aafre/ship -a codex
npx skills add aafre/ship -g
```

The first targets Codex; the second installs globally. See the
[skills CLI documentation](https://github.com/vercel-labs/skills) for supported agents and options.

For a manual install, copy [`skills/ship/`](skills/ship/) into your agent's skill discovery
directory, such as `.agents/skills/ship/` or `.claude/skills/ship/`. Claude Code users can
also copy `skills/ship/agents/*.md` into `.claude/agents/` to register the review roles.
Other hosts need a fresh-context session to perform independent review.

</details>

<details>
<summary>Optional local CLI for larger task graphs — experimental</summary>

The Markdown skill works without building the companion CLI. When available, the skill
can use `ship plan`, `ship run`, and `ship status` for task graphs and worktree management.
The CLI requires Node.js 22 or later and is built from source:

```bash
git clone https://github.com/aafre/ship.git
cd ship/packages/cli
npm ci
npm run build
npm link
```

See the [CLI plan](docs/ship-v0.2/plan.md) and [recorded smoke run](docs/ship-v0.2/smoke-log.md)
before relying on it for larger work. It is not a published npm package.

</details>

## Why ship is different

| Engineering problem | ship's approach |
|---|---|
| A tiny change gets a large workflow | Classify first; keep small, low-risk work short. |
| Checks are guessed or skipped | Discover repository commands and report what actually ran. |
| Review inherits the author's explanation | Brief a fresh reviewer with criteria, diff, and test results; omit the author's rationale. |
| Reviewer suggestions introduce new bugs | Confirm findings before applying fixes, then re-check. |
| Every task loads every procedure | Keep phase-specific guidance in reference files loaded when needed. |

These are workflow instructions, not enforced guarantees. Independent review needs a
fresh-context host capability; otherwise the report must mark review **pending**.
Deferred reference loading reduces upfront instruction text; it does not mean zero context cost.

## How it works

1. **Size and inspect.** Classify the change, find related code and tests, and reuse repo conventions.
2. **Plan when useful.** Set acceptance criteria; split work only when tasks are independent.
3. **Implement and check.** Make the change and run the repository's relevant commands.
4. **Review substantive changes.** Use fresh context; sensitive changes warrant review even when small.
5. **Confirm and report.** Verify findings, fix confirmed issues, re-check, and name remaining gaps.

Small, low-risk changes collapse to inspect → edit → check → report. Larger work can use
dependency graphs and isolated worktrees after shared interfaces are settled.

For the exact rules, read the [core skill](skills/ship/SKILL.md),
[review contract](skills/ship/references/review-contract.md),
[verification contract](skills/ship/references/verifier-contract.md), and
[parallelism guidance](skills/ship/references/parallelism.md).

## Which agents

The package uses the [Agent Skills format](https://agentskills.io/specification).
Installation support does not establish end-to-end behavior. Evidence currently documented in this repo:

| Host | Documented support | Limit |
|---|---|---|
| Claude Code | Plugin integration and project development use; one recorded CLI smoke run | The CLI run covers a single small task with a Claude worker. |
| Codex, OpenCode, Pi | Skill loading reported in headless checks | Loading is not an end-to-end workflow test. |
| Other hosts supported by the skills CLI | Installation path available | Loading and behavior need host-specific verification. |

Pi's reported loading check used global installation (`-g -a pi`); project-scope discovery
needed an explicit `--skill .pi/skills/ship` in that test. Agent behavior can vary by version.

Without a registered reviewer, ship's instructions fall back to another fresh-context
session. Without either capability, independent review remains pending.
Share your host version, install command, and observed result in an
[issue](https://github.com/aafre/ship/issues) to improve this matrix.

## When to use ship

Use it for features, bug fixes, refactors, migrations, API changes, and reliability work
where the agent should own implementation through verification.

For explanations, brainstorming, or code reading, the full workflow is unnecessary.
ship complements your tests, CI, and human review. It does not enforce test-first development
or replace any of those checks. Extra review steps can add time and model usage.

## Project status

**Early, usable for experimentation, and unbenchmarked.** The skill and optional CLI have
different levels of evidence:

| Area | Evidence available |
|---|---|
| Skill workflow and review roles | Inspectable instructions in [`skills/ship/`](skills/ship/). |
| Behavioral evaluations | [Ten cases and a validator](evals/README.md); no published outcome comparison yet. |
| Optional CLI | Unit/fixture tests plus [one recorded live smoke run](docs/ship-v0.2/smoke-log.md). |
| Codex-worker and multi-task CLI execution | The smoke log records these as not yet run. |
| Defect reduction, speed, or token savings | Not established by a published benchmark. |

The live smoke run took four attempts and exposed bugs that fixture tests missed.
Read the log for scope and fixes. A successful small run does not establish reliability
for a large migration. Fresh context also does not guarantee that a reviewer catches every defect.

Next priorities: expand live host/task coverage, run and calibrate the behavioral evals,
publish a reproducible with/without comparison, and capture a real worked example.

## Security and privacy

The skill itself is Markdown. Your coding agent still executes commands and may send code
and prompts to its configured model provider. Review your host's permissions and data settings.

Reviewer and verifier roles are instructed not to modify source; those instructions are
not a filesystem sandbox. The optional CLI executes workers and manages git worktrees;
inspect it and use normal repository safeguards before running it.

## Contributing

Useful contributions include reproducible failures, host compatibility reports, eval results,
and small fixes. [Open an issue](https://github.com/aafre/ship/issues) with the request,
expected behavior, actual behavior, agent/version, and relevant output. Remove secrets first.

Edit **`skills/ship/`**, the canonical source. `.claude/` and `.claude-plugin/` contain
generated integrations. With Node.js 22 or later:

```bash
git clone https://github.com/aafre/ship.git
cd ship/packages/cli
npm ci
# Edit the canonical files under ../../skills/ship/.
npm run build:integrations
npm run check:drift
# For CLI changes:
npm test
```

Keep the core skill focused; put phase-specific detail in references. Explain which failure
a new rule prevents. Include checks run and limitations with your PR. See
[`evals/README.md`](evals/README.md) for behavioral evaluation setup.

| Path | Purpose |
|---|---|
| [`skills/ship/`](skills/ship/) | Canonical skill, review roles, and reference guidance |
| [`.claude/`](.claude/) / [`.claude-plugin/`](.claude-plugin/) | Generated host integrations |
| [`packages/cli/`](packages/cli/) | Optional TypeScript CLI and tests |
| [`evals/`](evals/) | Behavioral cases and structural validator |
| [`docs/ship-v0.2/`](docs/ship-v0.2/) | CLI design and live-run evidence |

If ship helps you complete a real change, a star helps others discover it.
A reproducible report helps make the next run better.

## License

[MIT](LICENSE).
