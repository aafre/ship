# README and launch readiness

Assessment: 2026-09-14. Scope: documentation, package metadata, tracked repository
files, public GitHub metadata, and selected upstream READMEs. Not a source-code audit
or end-to-end certification.

## Verdict

Ready to invite early adopters. The premise is clear: task-sized workflow, repository-native
checks, and fresh-context review with findings verified before fixes. Evidence does not yet
support broad reliability, performance, or universal compatibility claims.

README polish improves comprehension and the path to a first trial. It cannot predict stars.
Popular projects provide design examples, not proof that their README caused adoption.

## Research

| Source | Observed pattern | Application |
|---|---|---|
| [GitHub guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) | Purpose, value, setup, help, and contributors. | Make these paths easy to find. |
| [uv](https://github.com/astral-sh/uv/blob/main/README.md) | Highlights, performance visual, install, deeper documentation. | Show concrete value; measure before claiming performance. |
| [Turborepo](https://github.com/vercel/turborepo/blob/main/README.md) | Brief identity and links into docs/community. | Keep the landing page focused. |
| [GitHub CLI](https://github.com/cli/cli/blob/trunk/README.md) | Product definition, visual example, install, contribution paths. | Show the result before internals. |
| [Superpowers](https://github.com/obra/superpowers/blob/main/README.md) | Agent-workflow explanation and host-specific setup. | Distinguish generic skills from native plugin integration. |
| [Anthropic skills](https://github.com/anthropics/skills/blob/main/README.md) | Explains the skill abstraction and practical usage. | Explain that ship extends a coding agent. |
| [Skills CLI](https://github.com/vercel-labs/skills/blob/main/README.md) | Primary install command with separate agent/scope options. | Lead with `npx skills add aafre/ship`. |

Do: concise value, concrete example, obvious first action, prerequisites, support boundaries,
linked evidence, and an easy contribution path. Use native GitHub details blocks for alternatives.

Avoid: badge walls, invented demos, unsupported competitor scorecards, star forecasts,
universal compatibility claims, or equating file size with measured token savings.

## Decisions on the supplied feedback

| Suggestion | Decision |
|---|---|
| Move terminal output up | Adopt; label illustrative output explicitly. |
| Add animated demo | Capture a reproducible real session first. No synthetic recording presented as proof. |
| Condense pitch | Adopt three outcome bullets and a problem/approach table. |
| Promote one-line install | Adopt; retain the plugin's native-subagent distinction. No ten-second promise. |
| Collapse alternatives | Adopt native details blocks. |
| Separate product from whitepaper | Link canonical reference documents; keep concise status and capability limits in README. |
| “Zero Context Tax on Small Tasks” | Reject: the core skill still loads; token impact is unmeasured. |
| “Exceptional technical integrity” | Not established by documentation inspection. |
| Default-agent “disaster” comparison | Avoid unsupported claims about other tools; describe ship's intended behavior. |

## Findings

- Public [repository metadata](https://api.github.com/repos/aafre/ship) at inspection:
  0 stars, 0 forks, no topics, no homepage. This measures discoverability setup, not quality.
- No tracked `.github/` workflows, standalone contribution guide, security policy, or
  changelog appeared in the inventory. CI is the highest-value gap among these.
- Old README: roughly 26.5 KB, with structural metrics before installation.
- Its 13.9 KB core / five references metrics were stale: canonical core measured 16,418
  bytes, with six reference files. Removed brittle counts from the landing page.
- “Nothing leaves your machine” ignored host model/network behavior. Corrected.
- Contributor commands omitted `cd ship`, assumed an external validator, and mixed working
  directories. Replaced with the repository's package scripts.
- Plugin metadata: 0.2.1; CLI package: 0.1.0; old README badge: v0.1. Replaced badge with
  “early”; version alignment remains follow-up work.
- [Smoke log](ship-v0.2/smoke-log.md): one Claude-host/Claude-worker small task, requiring
  four attempts and fixes. Codex-worker and multi-task runs remain marked not run.
- [Behavioral cases](../evals/README.md) exist; published with/without outcome results do not.
  Structural validation is not a behavioral evaluation.

## Priorities

1. Test documented installation in a clean environment on named host versions; record a
   real issue, commands, result, and limitations. Put a short recording near the README top.
2. Add CI for integration drift, CLI tests, and eval structure. Add a badge after CI runs.
3. Exercise Codex workers and multi-task/manual-task flows; publish the evidence.
4. Run the same tasks with and without ship. Report selection, versions, repetitions,
   defects, elapsed time, and model usage where available.
5. Add accurate GitHub topics and About copy. Suggested topics: `agent-skills`, `claude-code`,
   `code-review`, `developer-tools`, `ai-agents`. Add a demo link when available.
6. Share a specific worked result with relevant developer communities and invite early feedback.

Track successful first runs, repeat use, actionable reports, and outside contributions alongside
stars. No defensible star forecast follows from this inspection.

## This pass

Root README rewritten around usage, with an early example, primary install, expandable
alternatives, concise differentiation, support matrix, bounded evidence, corrected privacy
wording, and working-directory fixes. Canonical references retain the deeper workflow rules.

No recording, benchmark, CI workflow, repository metadata edit, release, or public post was
created in this documentation pass.
