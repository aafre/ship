import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitIntegration, integrateBranch, isWorktreeClean, mergeTaskBranch } from "./git.js";
import type { Task, TaskGraph, WorkerResult } from "./types.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ship-git-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Ship Test"]);
  writeFileSync(join(dir, "README.md"), "hello\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

function task(id: string, dependsOn: string[] = [], ownedPaths: string[] = [`${id}.txt`]): Task {
  return { version: 1, id, type: "agent", objective: `do ${id}`, dependsOn, ownedPaths };
}

function fakeResult(taskId: string): WorkerResult {
  return {
    version: 1,
    runId: "run-1",
    taskId,
    attemptId: "attempt-1",
    changedPaths: [],
    commandsRun: [],
    evidencePaths: [],
    blockers: [],
  };
}

/** Simulates a worker: writes its owned file and commits, inside the worktree Ship created. */
function simulateWork(worktreePath: string, fileName: string, content: string): void {
  writeFileSync(join(worktreePath, fileName), content);
  git(worktreePath, ["add", fileName]);
  git(worktreePath, ["commit", "-q", "-m", `implement ${fileName}`]);
}

test("independent siblings merge cleanly into the integrate branch", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B")] };
  const { resolveCwd, verify } = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });

  const aPath = resolveCwd(task("A"));
  simulateWork(aPath, "A.txt", "a\n");
  const aOutcome = await verify(task("A"), fakeResult("A"));
  assert.equal(aOutcome.status, "integrated");

  const bPath = resolveCwd(task("B"));
  simulateWork(bPath, "B.txt", "b\n");
  const bOutcome = await verify(task("B"), fakeResult("B"));
  assert.equal(bOutcome.status, "integrated");

  const integrateContents = git(repoRoot, ["show", `${integrateBranch("run-1")}:A.txt`]);
  assert.equal(integrateContents, "a");
  assert.equal(git(repoRoot, ["show", `${integrateBranch("run-1")}:B.txt`]), "b");
});

test("a dependent starts from the integrate head that already contains its prerequisite", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("C", ["A"])] };
  const { resolveCwd, verify } = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });

  const aPath = resolveCwd(task("A"));
  simulateWork(aPath, "A.txt", "a\n");
  await verify(task("A", []), fakeResult("A"));

  // C is only created after A is integrated, mirroring how run.ts's scheduler gates dispatch.
  const cPath = resolveCwd(task("C", ["A"]));
  assert.equal(
    readFileSync(join(cPath, "A.txt"), "utf8").replace(/\r\n/g, "\n"),
    "a\n",
    "C's worktree must already contain A's change",
  );
});

test("a merge conflict blocks the task and leaves the integrate head untouched", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  // Both tasks touch the same file to force a conflict; validateGraph would
  // normally reject this pairing, but git.ts must still fail safe if it happens.
  const graph: TaskGraph = { version: 1, tasks: [task("A", [], ["shared.txt"]), task("B", [], ["shared.txt"])] };
  const { resolveCwd, verify } = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });

  const aPath = resolveCwd(task("A", [], ["shared.txt"]));
  simulateWork(aPath, "shared.txt", "from A\n");
  const aOutcome = await verify(task("A", [], ["shared.txt"]), fakeResult("A"));
  assert.equal(aOutcome.status, "integrated");
  const headBefore = git(repoRoot, ["rev-parse", integrateBranch("run-1")]);

  const bPath = resolveCwd(task("B", [], ["shared.txt"]));
  simulateWork(bPath, "shared.txt", "from B\n");
  const bOutcome = await verify(task("B", [], ["shared.txt"]), fakeResult("B"));

  assert.equal(bOutcome.status, "blocked");
  assert.match(bOutcome.question ?? "", /merge conflict/);
  const headAfter = git(repoRoot, ["rev-parse", integrateBranch("run-1")]);
  assert.equal(headAfter, headBefore, "a conflicting merge must not move the integrate head");
});

test("a dirty user file in the repo root survives worktree creation and merging untouched", async () => {
  const repoRoot = initRepo();
  writeFileSync(join(repoRoot, "untracked-work.txt"), "do not touch me\n");

  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A")] };
  const { resolveCwd, verify } = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });

  const aPath = resolveCwd(task("A"));
  simulateWork(aPath, "A.txt", "a\n");
  await verify(task("A"), fakeResult("A"));

  assert.equal(readFileSync(join(repoRoot, "untracked-work.txt"), "utf8"), "do not touch me\n");
  assert.equal(git(repoRoot, ["status", "--porcelain"]).includes("untracked-work.txt"), true);
});

test("a dirty worktree is not removed after integration", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B")] };
  const { resolveCwd, verify } = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });

  const aPath = resolveCwd(task("A"));
  simulateWork(aPath, "A.txt", "a\n");
  writeFileSync(join(aPath, "leftover.txt"), "uncommitted");
  await verify(task("A"), fakeResult("A"));

  assert.ok(existsSync(aPath), "a dirty worktree must be left in place, not removed");
  assert.equal(isWorktreeClean(aPath), false);
});

test("single small task skips the integrate branch entirely", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A")] };
  const { resolveCwd, verify } = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });

  const aPath = resolveCwd(task("A"));
  simulateWork(aPath, "A.txt", "a\n");
  const outcome = await verify(task("A"), fakeResult("A"));

  assert.equal(outcome.status, "integrated");
  const branches = git(repoRoot, ["branch", "--list", integrateBranch("run-1")]);
  assert.equal(branches, "", "no integrate branch should exist for a single-task run");
});

test("failing affected checks after a clean merge marks the task failed and undoes the merge", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B")] };
  const { resolveCwd, verify } = createGitIntegration({
    repoRoot,
    runId: "run-1",
    worktreesDir,
    graph,
    runAffectedChecks: async () => false,
  });

  // Force the integrate branch to exist before recording its pre-merge head.
  const aPath = resolveCwd(task("A"));
  const headBefore = git(repoRoot, ["rev-parse", integrateBranch("run-1")]);

  simulateWork(aPath, "A.txt", "a\n");
  const outcome = await verify(task("A"), fakeResult("A"));
  assert.equal(outcome.status, "failed");

  const headAfter = git(repoRoot, ["rev-parse", integrateBranch("run-1")]);
  assert.equal(headAfter, headBefore, "a merge whose checks failed must be undone, not left in the integrate branch");
  assert.throws(
    () => git(repoRoot, ["show", `${integrateBranch("run-1")}:A.txt`]),
    "A.txt must not be reachable from the integrate branch after a failed check",
  );
});

test("a stale MERGE_HEAD left by a crashed merge is cleaned up, not reported as a real conflict", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B")] };
  const { resolveCwd, verify } = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });

  const aPath = resolveCwd(task("A"));
  simulateWork(aPath, "A.txt", "a\n");
  await verify(task("A"), fakeResult("A"));

  const bPath = resolveCwd(task("B"));
  simulateWork(bPath, "B.txt", "b\n");

  const integrateWorktreePath = join(worktreesDir, "integrate");
  // Simulate a crash mid-merge: start a real merge and kill it before it concludes.
  git(integrateWorktreePath, ["merge", "--no-commit", "--no-ff", "ship/run-1/B"]);
  assert.doesNotThrow(() => git(integrateWorktreePath, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]));

  const outcome = await verify(task("B"), fakeResult("B"));
  assert.equal(outcome.status, "integrated", "a stale MERGE_HEAD from a crash must not be mistaken for a content conflict");
});

test("a worktree left behind by an interrupted attempt is adopted, not recreated, on resume", async () => {
  const repoRoot = initRepo();
  const worktreesDir = join(repoRoot, ".worktrees");
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B")] };

  // First "process": starts A's worktree and commits work, then "crashes"
  // before verify() ever runs — nothing gets merged or cleaned up.
  const first = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });
  const aPath = first.resolveCwd(task("A"));
  simulateWork(aPath, "A.txt", "a\n");

  // Second "process": a fresh createGitIntegration instance (fresh in-memory
  // state, same runId/worktreesDir) resumes. It must not error trying to
  // recreate a branch/worktree that already exists, and must see A's commit.
  const second = createGitIntegration({ repoRoot, runId: "run-1", worktreesDir, graph });
  const resumedPath = second.resolveCwd(task("A"));
  assert.equal(resumedPath, aPath);
  assert.equal(readFileSync(join(resumedPath, "A.txt"), "utf8").replace(/\r\n/g, "\n"), "a\n");

  const outcome = await second.verify(task("A"), fakeResult("A"));
  assert.equal(outcome.status, "integrated");
});

test("mergeTaskBranch aborts cleanly when there is nothing to merge (no throw over throw)", () => {
  const repoRoot = initRepo();
  const outcome = mergeTaskBranch(repoRoot, "refs/heads/does-not-exist");
  assert.equal(outcome.merged, false);
  assert.equal(outcome.conflict, true);
});
