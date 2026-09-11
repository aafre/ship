import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RunState, Task, TaskGraph } from "./types.js";

const RUN_STATE_VERSION = 1;

/** Reads and validates a RunState file. Throws before the caller can act on bad data. */
export function readState(path: string): RunState {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read state file ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`malformed state file ${path}: not valid JSON`);
  }

  assertRunState(parsed, path);
  return parsed;
}

function assertRunState(value: unknown, path: string): asserts value is RunState {
  if (typeof value !== "object" || value === null) {
    throw new Error(`malformed state file ${path}: expected an object`);
  }
  const v = value as Record<string, unknown>;
  if (v.version !== RUN_STATE_VERSION) {
    throw new Error(`unsupported state version in ${path}: expected ${RUN_STATE_VERSION}, got ${JSON.stringify(v.version)}`);
  }
  if (typeof v.runId !== "string" || !v.runId) {
    throw new Error(`malformed state file ${path}: missing runId`);
  }
  if (v.approvedPlanRevision !== null && typeof v.approvedPlanRevision !== "string") {
    throw new Error(`malformed state file ${path}: approvedPlanRevision must be string or null`);
  }
  if (typeof v.tasks !== "object" || v.tasks === null) {
    throw new Error(`malformed state file ${path}: missing tasks map`);
  }
}

/** Writes state atomically: write to a sibling temp file, then rename over the target. */
export function writeState(path: string, state: RunState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, path);
}

export interface Lock {
  path: string;
  fd: number;
}

/** True if a process with this pid still exists. A Ctrl-C/crash leaves a pid nothing owns any more. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createLockFile(lockPath: string): Lock {
  const fd = openSync(lockPath, "wx");
  writeSync(fd, String(process.pid));
  return { path: lockPath, fd };
}

/**
 * Acquires an exclusive lock file in runDir, reclaiming one left behind by a
 * process that crashed or was killed without releasing it — never one still
 * owned by a live process.
 */
export function acquireLock(runDir: string): Lock {
  mkdirSync(runDir, { recursive: true });
  const lockPath = join(runDir, ".lock");
  try {
    return createLockFile(lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

    const ownerPid = Number(readFileSync(lockPath, "utf8").trim());
    if (Number.isInteger(ownerPid) && isProcessAlive(ownerPid)) {
      throw new Error(`run is locked: ${lockPath} is held by running process ${ownerPid}`);
    }

    unlinkSync(lockPath); // stale: the owning process is gone
    return createLockFile(lockPath);
  }
}

export function releaseLock(lock: Lock): void {
  closeSync(lock.fd);
  if (existsSync(lock.path)) unlinkSync(lock.path);
}

/** Validates a task graph: acyclic, every dependency exists, no ownership overlap among tasks that could run concurrently. */
export function validateGraph(graph: TaskGraph): void {
  const byId = new Map<string, Task>();
  for (const task of graph.tasks) {
    if (byId.has(task.id)) {
      throw new Error(`duplicate task id: ${task.id}`);
    }
    byId.set(task.id, task);
  }

  for (const task of graph.tasks) {
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) {
        throw new Error(`task ${task.id} depends on missing task ${dep}`);
      }
    }
  }

  assertAcyclic(graph.tasks);
  assertNoOwnershipOverlap(graph.tasks);
}

function assertAcyclic(tasks: Task[]): void {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(tasks.map((t) => [t.id, WHITE]));
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const visit = (id: string, path: string[]): void => {
    color.set(id, GRAY);
    for (const dep of byId.get(id)!.dependsOn) {
      const c = color.get(dep);
      if (c === GRAY) {
        throw new Error(`dependency cycle: ${[...path, id, dep].join(" -> ")}`);
      }
      if (c === WHITE) visit(dep, [...path, id]);
    }
    color.set(id, BLACK);
  };

  for (const task of tasks) {
    if (color.get(task.id) === WHITE) visit(task.id, []);
  }
}

/** Two tasks conflict if their owned paths overlap and neither depends (transitively) on the other. */
function assertNoOwnershipOverlap(tasks: Task[]): void {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ancestors = new Map<string, Set<string>>();

  const ancestorsOf = (id: string): Set<string> => {
    const cached = ancestors.get(id);
    if (cached) return cached;
    const result = new Set<string>();
    for (const dep of byId.get(id)!.dependsOn) {
      result.add(dep);
      for (const a of ancestorsOf(dep)) result.add(a);
    }
    ancestors.set(id, result);
    return result;
  };

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      const related = ancestorsOf(a.id).has(b.id) || ancestorsOf(b.id).has(a.id);
      if (related) continue;

      const overlap = a.ownedPaths.find((p) => b.ownedPaths.includes(p));
      if (overlap) {
        throw new Error(`tasks ${a.id} and ${b.id} can run concurrently but both own ${overlap}`);
      }
    }
  }
}
