#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as claude from "./adapters/claude.js";
import { loadEffectiveConfig } from "./config.js";
import { discover } from "./discover.js";
import { createGitIntegration } from "./git.js";
import { writePlan } from "./plan.js";
import type { PlanInput } from "./plan.js";
import { run } from "./run.js";
import { readState } from "./state.js";
import type { Profile, RunState, TaskGraph } from "./types.js";
import { runCheck } from "./verify.js";
import type { Task } from "./types.js";

const execFileAsync = promisify(execFile);

/** Reruns the repo's own test command (never assumed) against the worktree holding the just-merged code (plan §5) — never the caller's own working tree. No test command configured means nothing to gate on. */
function makeAffectedChecksRunner(repoRoot: string): (task: Task, worktreePath: string) => Promise<boolean> {
  const testCommand = discover(repoRoot).testCommand;
  if (!testCommand) return async () => true;
  const [command, ...args] = testCommand.split(" ");

  return async (task, worktreePath) => {
    const evidence = await runCheck(
      { id: `affected-checks-${task.id}`, type: "unit", requiredCapabilities: [], command: [command, ...args], cwd: worktreePath },
      {
        capabilities: {},
        runCommand: async (cmd, dir) => {
          try {
            await execFileAsync(cmd[0], cmd.slice(1), { cwd: dir });
            return { exitCode: 0 };
          } catch (err) {
            return { exitCode: (err as { code?: number }).code ?? 1 };
          }
        },
      },
    );
    return evidence.exitCode === 0;
  };
}

// ponytail: `.ship/runs/<run-id>` resolution and full first-run discovery
// (plan §2) live in the skill's own orchestration for now; this CLI takes
// explicit paths. Wiring those in is scope for when the skill actually calls
// this CLI end to end, not before.

export function formatStatus(state: RunState): string {
  const lines = Object.entries(state.tasks).map(([taskId, runtime]) => {
    const question = runtime.question ? ` — question: ${runtime.question}` : "";
    return `${taskId}: ${runtime.status}${question}`;
  });
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "plan") {
    const [plansRoot, runId, planInputPath] = rest;
    if (!plansRoot || !runId || !planInputPath) {
      console.error("usage: ship-cli plan <plansRoot> <runId> <planInputJsonPath>");
      return 1;
    }
    const input = JSON.parse(readFileSync(planInputPath, "utf8")) as PlanInput;
    const result = writePlan(plansRoot, runId, input);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (command === "run") {
    const [runDir, tasksPath] = rest;
    if (!runDir || !tasksPath) {
      console.error("usage: ship-cli run <runDir> <tasksJsonPath>");
      return 1;
    }
    const repoRoot = process.cwd();
    const graph = JSON.parse(readFileSync(tasksPath, "utf8")) as TaskGraph;
    const config = loadEffectiveConfig(repoRoot);
    const profile: Profile = { version: 1, runtime: "claude", model: config.models.implementer ?? "sonnet" };
    const git = createGitIntegration({
      repoRoot,
      runId: basename(runDir),
      worktreesDir: join(runDir, "worktrees"),
      graph,
      runAffectedChecks: makeAffectedChecksRunner(repoRoot),
    });

    const state = await run({
      runId: basename(runDir),
      graph,
      runDir,
      cwd: repoRoot,
      profile,
      adapter: claude,
      resolveCwd: git.resolveCwd,
      verify: git.verify,
    });
    console.log(formatStatus(state));
    return 0;
  }

  if (command === "status") {
    const [runDir] = rest;
    if (!runDir) {
      console.error("usage: ship-cli status <runDir>");
      return 1;
    }
    const state = readState(join(runDir, "state.json"));
    console.log(formatStatus(state));
    return 0;
  }

  console.error("usage: ship-cli <plan|run|status> ...");
  return 1;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
