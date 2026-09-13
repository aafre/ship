// Proves run.ts's resolveCwd/verify hooks compose with git.ts's
// createGitIntegration end to end: real worktrees, real merges, no fake
// adapter shortcuts around Git. The worker itself is still faked (a real
// claude/codex process can't be spawned in this sandbox — see T02/T03).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitIntegration } from "./git.js";
import { run } from "./run.js";
import type { Adapter, AdapterEvent } from "./run.js";
import type { Profile, Task, TaskGraph, WorkerResult } from "./types.js";

const profile: Profile = { version: 1, runtime: "claude", model: "sonnet" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ship-run-git-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Ship Test"]);
  writeFileSync(join(dir, "README.md"), "hello\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

function task(id: string, dependsOn: string[] = []): Task {
  return { version: 1, id, type: "agent", objective: `do ${id}`, dependsOn, ownedPaths: [`${id}.txt`] };
}

/** A fake worker: on launch, writes+commits its file in the given cwd and reports a matching WorkerResult. */
function gitBackedFakeAdapter(): Adapter {
  return {
    launch(_profile, briefing, cwd) {
      const match = briefing.match(/^Task (\S+) \(run (\S+), attempt (\S+)\):/);
      if (!match) throw new Error(`unexpected briefing: ${briefing}`);
      const [, taskId, runId, attemptId] = match;

      writeFileSync(join(cwd, `${taskId}.txt`), `${taskId} content\n`);
      git(cwd, ["add", `${taskId}.txt`]);
      git(cwd, ["commit", "-q", "-m", `implement ${taskId}`]);

      const result: WorkerResult = {
        version: 1,
        runId,
        taskId,
        attemptId,
        changedPaths: [`${taskId}.txt`],
        commandsRun: [],
        evidencePaths: [],
        blockers: [],
      };
      const event: AdapterEvent = { type: "result", raw: { is_error: false, result: JSON.stringify(result) } };
      return {
        sessionId: `${taskId}-${attemptId}`,
        pid: 1,
        events: (async function* () {
          yield event;
        })(),
      };
    },
    cancel() {},
  };
}

test("run() + createGitIntegration together take a two-task graph from dispatch to a merged integrate branch", async () => {
  const repoRoot = initRepo();
  const runDir = mkdtempSync(join(tmpdir(), "ship-run-dir-"));
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B", ["A"])] };

  const git_ = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir: join(runDir, "worktrees"), graph });

  const state = await run({
    runId: "run-1",
    graph,
    runDir,
    cwd: repoRoot,
    profile,
    adapter: gitBackedFakeAdapter(),
    resolveCwd: git_.resolveCwd,
    verify: git_.verify,
  });

  assert.equal(state.tasks.A.status, "integrated");
  assert.equal(state.tasks.B.status, "integrated");
  assert.ok(state.tasks.A.headCommit);
  assert.ok(state.tasks.B.headCommit);

  const integrateContents = git(repoRoot, ["show", "ship/run-1/integrate:B.txt"]).replace(/\r\n/g, "\n");
  assert.equal(integrateContents, "B content");
});
