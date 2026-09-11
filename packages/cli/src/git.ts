// Git delivery per plan section 7: worktree per concurrent task, branches
// under ship/<run-id>/, serialized merge into an integrate branch. Never
// touches the caller's own working tree — every operation here runs inside a
// dedicated worktree this module created.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Task, TaskGraph, VerifyOutcome, WorkerResult } from "./types.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function taskBranch(runId: string, taskId: string): string {
  return `ship/${runId}/${taskId}`;
}

export function integrateBranch(runId: string): string {
  return `ship/${runId}/integrate`;
}

export function baseCommit(repoRoot: string): string {
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

export function headOf(repoRoot: string, ref: string): string {
  return git(repoRoot, ["rev-parse", ref]);
}

function branchExists(repoRoot: string, branch: string): boolean {
  try {
    git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a branch + worktree, or adopts one left behind by a prior attempt
 * this process didn't finish (a crash, Ctrl-C). Never recreates a branch that
 * already exists — that would either error or silently orphan the earlier
 * commits an interrupted worker made.
 */
function createOrAdoptWorktree(repoRoot: string, branch: string, worktreePath: string, baseRef: string): void {
  if (existsSync(worktreePath)) return; // left behind by an interrupted attempt; reuse as-is
  if (branchExists(repoRoot, branch)) {
    git(repoRoot, ["worktree", "add", worktreePath, branch]);
  } else {
    git(repoRoot, ["worktree", "add", worktreePath, "-b", branch, baseRef]);
  }
}

export function createIntegrateWorktree(repoRoot: string, runId: string, worktreesDir: string, base: string): string {
  const path = join(worktreesDir, "integrate");
  mkdirSync(worktreesDir, { recursive: true });
  createOrAdoptWorktree(repoRoot, integrateBranch(runId), path, base);
  return path;
}

export function createTaskWorktree(
  repoRoot: string,
  runId: string,
  taskId: string,
  worktreesDir: string,
  baseRef: string,
): { worktreePath: string; branch: string } {
  const branch = taskBranch(runId, taskId);
  const worktreePath = join(worktreesDir, taskId);
  mkdirSync(worktreesDir, { recursive: true });
  createOrAdoptWorktree(repoRoot, branch, worktreePath, baseRef);
  return { worktreePath, branch };
}

export function isWorktreeClean(worktreePath: string): boolean {
  return git(worktreePath, ["status", "--porcelain"]).length === 0;
}

/** Removes a worktree only if it's clean. Returns whether it removed it — a dirty or failed one is left for reconciliation. */
export function removeWorktreeIfClean(repoRoot: string, worktreePath: string): boolean {
  if (!isWorktreeClean(worktreePath)) return false;
  git(repoRoot, ["worktree", "remove", worktreePath]);
  return true;
}

export interface MergeOutcome {
  merged: boolean;
  conflict: boolean;
}

/** True if a previous merge attempt in this worktree crashed mid-merge, leaving MERGE_HEAD behind. */
function hasStaleMerge(worktreePath: string): boolean {
  try {
    git(worktreePath, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merges branch into whatever is checked out in integrateWorktreePath. A
 * MERGE_HEAD left over from a crashed prior attempt is cleaned up first — that
 * is resume housekeeping, not a conflict from *this* attempt. On an actual
 * conflict, aborts so the integrate head is left untouched.
 */
export function mergeTaskBranch(integrateWorktreePath: string, branch: string): MergeOutcome {
  if (hasStaleMerge(integrateWorktreePath)) {
    try {
      git(integrateWorktreePath, ["merge", "--abort"]);
    } catch {
      // already clean somehow — fine
    }
  }

  try {
    git(integrateWorktreePath, ["merge", "--no-ff", "--no-edit", branch]);
    return { merged: true, conflict: false };
  } catch {
    try {
      git(integrateWorktreePath, ["merge", "--abort"]);
    } catch {
      // nothing to abort (merge failed before touching MERGE_HEAD) — fine
    }
    return { merged: false, conflict: true };
  }
}

export interface GitIntegrationOptions {
  repoRoot: string;
  runId: string;
  /** Where per-task and integrate worktrees live, e.g. join(runDir, "worktrees"). */
  worktreesDir: string;
  graph: TaskGraph;
  /** Reruns the checks affected by this task's merge; defaults to "no checks configured, trust the merge." */
  runAffectedChecks?: (task: Task) => Promise<boolean>;
}

/**
 * Wires run.ts's resolveCwd/verify hooks to real Git delivery. A graph with a
 * single task skips the integrate branch entirely (plan §7: "no ceremony").
 */
export function createGitIntegration(opts: GitIntegrationOptions): {
  resolveCwd: (task: Task) => string;
  verify: (task: Task, result: WorkerResult) => Promise<VerifyOutcome>;
} {
  const { repoRoot, runId, worktreesDir, graph } = opts;
  const runAffectedChecks = opts.runAffectedChecks ?? (async () => true);
  const single = graph.tasks.length === 1;
  const base = baseCommit(repoRoot);

  let integrateWorktreePath: string | undefined;
  const taskWorktrees = new Map<string, { worktreePath: string; branch: string; baseRef: string }>();

  function resolveCwd(task: Task): string {
    const existing = taskWorktrees.get(task.id);
    if (existing) return existing.worktreePath;

    if (!single && !integrateWorktreePath) {
      integrateWorktreePath = createIntegrateWorktree(repoRoot, runId, worktreesDir, base);
    }

    const baseRef = single ? base : task.dependsOn.length === 0 ? base : integrateBranch(runId);
    const created = createTaskWorktree(repoRoot, runId, task.id, worktreesDir, baseRef);
    taskWorktrees.set(task.id, { ...created, baseRef });
    return created.worktreePath;
  }

  async function verify(task: Task): Promise<VerifyOutcome> {
    const wt = taskWorktrees.get(task.id);
    if (!wt) return { status: "failed" };
    const headCommit = headOf(repoRoot, wt.branch);

    if (single) {
      if (!(await runAffectedChecks(task))) return { status: "failed" };
      return { status: "integrated", baseCommit: wt.baseRef, headCommit };
    }

    if (!integrateWorktreePath) return { status: "failed" };
    const preMergeHead = headOf(repoRoot, integrateBranch(runId));
    const { merged, conflict } = mergeTaskBranch(integrateWorktreePath, wt.branch);
    if (conflict) {
      return {
        status: "blocked",
        question: `merge conflict integrating ${task.id} (${wt.branch}) into ${integrateBranch(runId)}`,
      };
    }
    if (!merged) return { status: "failed" };

    if (!(await runAffectedChecks(task))) {
      // The merge commit already landed; checks are supposed to gate
      // integration, not follow it, so undo it and leave the integrate
      // head exactly where it was before this attempt.
      git(integrateWorktreePath, ["reset", "--hard", preMergeHead]);
      return { status: "failed" };
    }

    removeWorktreeIfClean(repoRoot, wt.worktreePath);
    return { status: "integrated", baseCommit: wt.baseRef, headCommit };
  }

  return { resolveCwd, verify };
}
