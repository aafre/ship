import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DEFAULT_SLOTS, isTerminal, selectReadyTasks } from "./scheduler.js";
import type { SlotConfig } from "./scheduler.js";
import { acquireLock, readState, releaseLock, writeState } from "./state.js";
import type { Profile, RunState, Task, TaskGraph, WorkerResult } from "./types.js";

export interface AdapterEvent {
  type: string;
  raw: unknown;
}

export interface Adapter {
  launch(
    profile: Profile,
    briefing: string,
    cwd: string,
  ): { sessionId: string; pid: number; events: AsyncIterable<AdapterEvent> };
  cancel(sessionId: string): void;
}

export interface RunOptions {
  runId: string;
  graph: TaskGraph;
  runDir: string;
  cwd: string;
  profile: Profile;
  adapter: Adapter;
  slots?: SlotConfig;
  buildBriefing?: (task: Task, runId: string, attemptId: string) => string;
  /**
   * ponytail: T04 adds real Git integration and T07 adds real review/verify
   * routing. Until then, this decides whether an implemented task counts as
   * integrated; the default trusts a successful implement.
   */
  verify?: (task: Task, result: WorkerResult) => Promise<boolean>;
  signal?: AbortSignal;
}

function defaultBriefing(task: Task, runId: string, attemptId: string): string {
  return [
    `Task ${task.id} (run ${runId}, attempt ${attemptId}): ${task.objective}`,
    `Owned paths: ${task.ownedPaths.join(", ") || "(none declared)"}`,
    "Reply with exactly one JSON object matching WorkerResult, nothing else:",
    `{"version":1,"runId":"${runId}","taskId":"${task.id}","attemptId":"${attemptId}",` +
      `"changedPaths":[],"commandsRun":[],"evidencePaths":[],"blockers":[]}`,
  ].join("\n");
}

async function defaultVerify(): Promise<boolean> {
  return true;
}

type Outcome = { ok: true; result: WorkerResult } | { ok: false; reason: string };

async function collectResult(events: AsyncIterable<AdapterEvent>): Promise<Outcome> {
  for await (const event of events) {
    if (event.type === "result") {
      const raw = event.raw as { is_error?: boolean; result?: string };
      if (raw.is_error) return { ok: false, reason: "worker reported an error" };
      try {
        return { ok: true, result: JSON.parse(raw.result ?? "") as WorkerResult };
      } catch {
        return { ok: false, reason: "worker result was not valid JSON" };
      }
    }
    if (event.type === "adapter_spawn_error" || event.type === "adapter_nonzero_exit" || event.type === "adapter_incomplete_stream") {
      return { ok: false, reason: event.type };
    }
  }
  return { ok: false, reason: "worker produced no result" };
}

function freshState(runId: string, graph: TaskGraph): RunState {
  return {
    version: 1,
    runId,
    approvedPlanRevision: null,
    tasks: Object.fromEntries(graph.tasks.map((t) => [t.id, { status: "pending" as const }])),
  };
}

/**
 * Runs a task graph to completion (or until interrupted). No Git integration
 * here — that's T04; "integrated" is decided entirely by `verify`.
 */
export async function run(options: RunOptions): Promise<RunState> {
  const slots = options.slots ?? DEFAULT_SLOTS;
  const buildBriefing = options.buildBriefing ?? defaultBriefing;
  const verify = options.verify ?? defaultVerify;
  const statePath = join(options.runDir, "state.json");

  const lock = acquireLock(options.runDir);
  try {
    let state: RunState;
    try {
      state = readState(statePath);
    } catch {
      state = freshState(options.runId, options.graph);
    }

    // A resumed run may see tasks.json grow (e.g. a plan revision); anything
    // new to state starts pending. Existing entries are never reset here.
    for (const t of options.graph.tasks) {
      if (!state.tasks[t.id]) state.tasks[t.id] = { status: "pending" };
    }

    // A process that died mid-run leaves nothing live behind; a task still
    // "running" from a prior attempt gets one more try.
    for (const runtime of Object.values(state.tasks)) {
      if (runtime.status === "running") runtime.status = "ready";
    }
    writeState(statePath, state);

    while (Object.values(state.tasks).some((t) => !isTerminal(t.status))) {
      if (options.signal?.aborted) break;

      const ready = selectReadyTasks(options.graph, state, slots);
      if (ready.length === 0) break; // nothing dispatchable and T03 has no other source of progress

      const dispatched = ready.map((task) => {
        const attemptId = randomUUID();
        const briefing = buildBriefing(task, options.runId, attemptId);
        const { sessionId, pid, events } = options.adapter.launch(options.profile, briefing, options.cwd);
        state.tasks[task.id] = { status: "running", attemptId, sessionId, pid };
        return { task, attemptId, sessionId, events };
      });
      writeState(statePath, state);

      const outcomes = await Promise.all(
        dispatched.map(async ({ task, attemptId, sessionId, events }) => ({
          task,
          attemptId,
          sessionId,
          outcome: await collectResult(events),
        })),
      );

      for (const { task, attemptId, sessionId, outcome } of outcomes) {
        const runtime = state.tasks[task.id];
        if (runtime.attemptId !== attemptId || runtime.sessionId !== sessionId) {
          continue; // superseded by a newer attempt; ignore this stale result
        }

        if (!outcome.ok) {
          runtime.status = "failed";
          continue;
        }

        const result = outcome.result;
        if (result.runId !== options.runId || result.taskId !== task.id || result.attemptId !== attemptId) {
          runtime.status = "failed"; // result doesn't match what we dispatched; never trust it
          continue;
        }

        if (result.blockers && result.blockers.length > 0) {
          runtime.status = "blocked";
          runtime.question = result.blockers[0];
          continue;
        }

        runtime.status = "implemented";
        runtime.evidencePaths = result.evidencePaths;
        runtime.status = (await verify(task, result)) ? "integrated" : "failed";
      }

      writeState(statePath, state);
    }

    return state;
  } finally {
    releaseLock(lock);
  }
}
