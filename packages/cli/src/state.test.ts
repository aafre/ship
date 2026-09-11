import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireLock, readState, releaseLock, validateGraph, writeState } from "./state.js";
import type { RunState, TaskGraph } from "./types.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ship-state-test-"));
}

function baseState(overrides: Partial<RunState> = {}): RunState {
  return {
    version: 1,
    runId: "run-1",
    approvedPlanRevision: null,
    tasks: {},
    ...overrides,
  };
}

test("writeState is atomic: a temp file left behind by a simulated crash does not corrupt the target", () => {
  const dir = tempDir();
  const statePath = join(dir, "state.json");

  writeState(statePath, baseState());
  const before = readFileSync(statePath, "utf8");

  // Simulate a crash between "write temp" and "rename": leave a temp file with
  // garbage content and never rename it over the target.
  writeFileSync(join(dir, ".crash.tmp"), "not valid json {{{");

  const after = readFileSync(statePath, "utf8");
  assert.equal(after, before, "target file must be untouched by an unrenamed temp write");
  assert.deepEqual(readState(statePath), baseState());
});

test("acquireLock fails on a second acquire while the first is held", () => {
  const dir = tempDir();
  const lock = acquireLock(dir);
  assert.throws(() => acquireLock(dir), /already exists/);
  releaseLock(lock);
  // Released lock can be re-acquired.
  const lock2 = acquireLock(dir);
  releaseLock(lock2);
});

test("readState rejects malformed JSON before returning anything usable", () => {
  const dir = tempDir();
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, "{not json");
  assert.throws(() => readState(statePath), /not valid JSON/);
});

test("readState rejects a wrong-version state file", () => {
  const dir = tempDir();
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({ ...baseState(), version: 2 }));
  assert.throws(() => readState(statePath), /unsupported state version/);
});

test("readState rejects a state file missing required fields", () => {
  const dir = tempDir();
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({ version: 1 }));
  assert.throws(() => readState(statePath), /missing runId/);
});

function graph(tasks: TaskGraph["tasks"]): TaskGraph {
  return { version: 1, tasks };
}

test("validateGraph accepts a valid acyclic graph with no ownership overlap", () => {
  const g = graph([
    { version: 1, id: "A", type: "agent", objective: "a", dependsOn: [], ownedPaths: ["src/a.ts"] },
    { version: 1, id: "B", type: "agent", objective: "b", dependsOn: ["A"], ownedPaths: ["src/b.ts"] },
  ]);
  assert.doesNotThrow(() => validateGraph(g));
});

test("validateGraph rejects a missing dependency", () => {
  const g = graph([
    { version: 1, id: "A", type: "agent", objective: "a", dependsOn: ["ghost"], ownedPaths: [] },
  ]);
  assert.throws(() => validateGraph(g), /depends on missing task ghost/);
});

test("validateGraph rejects a cycle", () => {
  const g = graph([
    { version: 1, id: "A", type: "agent", objective: "a", dependsOn: ["B"], ownedPaths: [] },
    { version: 1, id: "B", type: "agent", objective: "b", dependsOn: ["A"], ownedPaths: [] },
  ]);
  assert.throws(() => validateGraph(g), /dependency cycle/);
});

test("validateGraph rejects overlapping ownership between concurrently-runnable tasks", () => {
  const g = graph([
    { version: 1, id: "A", type: "agent", objective: "a", dependsOn: [], ownedPaths: ["src/shared.ts"] },
    { version: 1, id: "B", type: "agent", objective: "b", dependsOn: [], ownedPaths: ["src/shared.ts"] },
  ]);
  assert.throws(() => validateGraph(g), /both own src\/shared\.ts/);
});

test("validateGraph allows the same owned path when one task depends on the other", () => {
  const g = graph([
    { version: 1, id: "A", type: "agent", objective: "a", dependsOn: [], ownedPaths: ["src/shared.ts"] },
    { version: 1, id: "B", type: "agent", objective: "b", dependsOn: ["A"], ownedPaths: ["src/shared.ts"] },
  ]);
  assert.doesNotThrow(() => validateGraph(g));
});
