import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatStatus } from "./cli.js";
import { run } from "./run.js";
import type { Adapter, AdapterEvent } from "./run.js";
import type { Profile, Task, TaskGraph, WorkerResult } from "./types.js";

const profile: Profile = { version: 1, runtime: "claude", model: "sonnet" };

function tempRunDir(): string {
  return mkdtempSync(join(tmpdir(), "ship-run-test-"));
}

function task(id: string, dependsOn: string[] = [], ownedPaths: string[] = [`src/${id}.ts`]): Task {
  return { version: 1, id, type: "agent", objective: `do ${id}`, dependsOn, ownedPaths };
}

interface Handled {
  runId: string;
  taskId: string;
  attemptId: string;
}

type Handler = (ctx: Handled) => AdapterEvent[];

function successEvent(ctx: Handled, overrides: Partial<WorkerResult> = {}): AdapterEvent {
  const result: WorkerResult = {
    version: 1,
    runId: ctx.runId,
    taskId: ctx.taskId,
    attemptId: ctx.attemptId,
    changedPaths: [],
    commandsRun: [],
    evidencePaths: [],
    blockers: [],
    ...overrides,
  };
  return { type: "result", raw: { is_error: false, result: JSON.stringify(result) } };
}

const BRIEFING_RE = /^Task (\S+) \(run (\S+), attempt (\S+)\):/;

function fakeAdapter(handlers: Record<string, Handler>): { adapter: Adapter; launches: Handled[] } {
  const launches: Handled[] = [];
  const adapter: Adapter = {
    launch(_profile: Profile, briefing: string) {
      const match = briefing.match(BRIEFING_RE);
      if (!match) throw new Error(`unexpected briefing shape: ${briefing}`);
      const [, taskId, runId, attemptId] = match;
      const ctx = { runId, taskId, attemptId };
      launches.push(ctx);
      const handler = handlers[taskId];
      if (!handler) throw new Error(`fake adapter has no handler for task ${taskId} (unexpected relaunch?)`);
      const events = handler(ctx);
      return {
        sessionId: `${taskId}-${attemptId}`,
        pid: 1,
        events: (async function* () {
          for (const e of events) yield e;
        })(),
      };
    },
    cancel() {},
  };
  return { adapter, launches };
}

test("dispatches independent tasks together and only starts a dependent once its deps are integrated", async () => {
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B"), task("C", ["A", "B"])] };
  const { adapter, launches } = fakeAdapter({
    A: (ctx) => [successEvent(ctx)],
    B: (ctx) => [successEvent(ctx)],
    C: (ctx) => [successEvent(ctx)],
  });

  const state = await run({ runId: "run-1", graph, runDir: tempRunDir(), cwd: process.cwd(), profile, adapter });

  assert.equal(state.tasks.A.status, "integrated");
  assert.equal(state.tasks.B.status, "integrated");
  assert.equal(state.tasks.C.status, "integrated");

  const cIndex = launches.findIndex((l) => l.taskId === "C");
  const abIndexes = launches.map((l, i) => (l.taskId === "A" || l.taskId === "B" ? i : -1)).filter((i) => i >= 0);
  assert.ok(abIndexes.every((i) => i < cIndex), "C must launch only after A and B");
});

test("rejects a result whose attempt id does not match what was dispatched", async () => {
  const graph: TaskGraph = { version: 1, tasks: [task("A")] };
  const { adapter } = fakeAdapter({
    A: (ctx) => [successEvent(ctx, { attemptId: "not-the-dispatched-attempt" })],
  });

  const state = await run({ runId: "run-1", graph, runDir: tempRunDir(), cwd: process.cwd(), profile, adapter });
  assert.equal(state.tasks.A.status, "failed");
});

test("a successful process alone does not release dependents; only a passed verify does", async () => {
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("C", ["A"])] };
  const { adapter, launches } = fakeAdapter({
    A: (ctx) => [successEvent(ctx)],
  });

  const state = await run({
    runId: "run-1",
    graph,
    runDir: tempRunDir(),
    cwd: process.cwd(),
    profile,
    adapter,
    verify: async () => ({ status: "failed" }),
  });

  assert.equal(state.tasks.A.status, "failed");
  assert.equal(state.tasks.C.status, "pending");
  assert.ok(!launches.some((l) => l.taskId === "C"));
});

test("a blocking question moves the task to blocked and status reports it", async () => {
  const graph: TaskGraph = { version: 1, tasks: [task("A")] };
  const { adapter } = fakeAdapter({
    A: (ctx) => [successEvent(ctx, { blockers: ["which port should the dev server use?"] })],
  });

  const state = await run({ runId: "run-1", graph, runDir: tempRunDir(), cwd: process.cwd(), profile, adapter });

  assert.equal(state.tasks.A.status, "blocked");
  assert.match(formatStatus(state), /blocked — question: which port should the dev server use\?/);
});

test("resuming a run does not relaunch an already-integrated task", async () => {
  const runDir = tempRunDir();

  const firstGraph: TaskGraph = { version: 1, tasks: [task("A")] };
  const { adapter: firstAdapter } = fakeAdapter({ A: (ctx) => [successEvent(ctx)] });
  const firstState = await run({ runId: "run-1", graph: firstGraph, runDir, cwd: process.cwd(), profile, adapter: firstAdapter });
  assert.equal(firstState.tasks.A.status, "integrated");

  const secondGraph: TaskGraph = { version: 1, tasks: [task("A"), task("B"), task("C", ["A", "B"])] };
  const { adapter: secondAdapter, launches } = fakeAdapter({
    B: (ctx) => [successEvent(ctx)],
    C: (ctx) => [successEvent(ctx)],
    // deliberately no handler for "A": if run() tries to relaunch it, the
    // fake adapter throws and the test fails loudly.
  });

  const secondState = await run({ runId: "run-1", graph: secondGraph, runDir, cwd: process.cwd(), profile, adapter: secondAdapter });

  assert.equal(secondState.tasks.A.status, "integrated");
  assert.equal(secondState.tasks.B.status, "integrated");
  assert.equal(secondState.tasks.C.status, "integrated");
  assert.ok(!launches.some((l) => l.taskId === "A"));
});

test("running a plan for the first time is the approval; a changed plan is refused until re-approved", async () => {
  const runDir = tempRunDir();
  const graph: TaskGraph = { version: 1, tasks: [task("A")] };
  const { adapter } = fakeAdapter({ A: (ctx) => [successEvent(ctx)] });

  const first = await run({ runId: "run-1", graph, runDir, cwd: process.cwd(), profile, adapter, planRevisionHash: "rev-1" });
  assert.equal(first.approvedPlanRevision, "rev-1");
  assert.equal(first.tasks.A.status, "integrated");

  const { adapter: secondAdapter } = fakeAdapter({});
  await assert.rejects(
    run({ runId: "run-1", graph, runDir, cwd: process.cwd(), profile, adapter: secondAdapter, planRevisionHash: "rev-2" }),
    /re-approve/,
  );

  // Running the originally-approved revision again still works.
  const { adapter: thirdAdapter } = fakeAdapter({});
  const third = await run({ runId: "run-1", graph, runDir, cwd: process.cwd(), profile, adapter: thirdAdapter, planRevisionHash: "rev-1" });
  assert.equal(third.tasks.A.status, "integrated");
});
