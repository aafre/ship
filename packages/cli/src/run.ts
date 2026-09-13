import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DEFAULT_SLOTS, isTerminal, selectReadyTasks } from "./scheduler.js";
import type { SlotConfig } from "./scheduler.js";
import { acquireLock, readState, releaseLock, writeState } from "./state.js";
import type { Profile, RunState, Task, TaskGraph, VerifyOutcome, WorkerResult } from "./types.js";

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
   * Decides what happens to an implemented task: git.ts's createGitIntegration
   * supplies the real merge-and-check logic; the default just trusts a clean
   * implement (useful for tests and for T07's not-yet-built review routing).
   */
  verify?: (task: Task, result: WorkerResult) => Promise<VerifyOutcome>;
  /** Per-task working directory; git.ts's createGitIntegration supplies per-task worktrees. Defaults to a single shared cwd. */
  resolveCwd?: (task: Task) => string;
  /**
   * The revision hash of the plan being run (plan.ts's revisionHash()). `run`
   * on a plan is the approval (plan §4): the first run binds this hash into
   * state; a later run with a different hash means the plan changed after
   * approval and refuses to dispatch anything until it matches again.
   */
  planRevisionHash?: string;
  signal?: AbortSignal;
}

function defaultBriefing(task: Task, runId: string, attemptId: string): string {
  return [
    `Task ${task.id} (run ${runId}, attempt ${attemptId}): ${task.objective}`,
    `Owned paths: ${task.ownedPaths.join(", ") || "(none declared)"}`,
    "",
    "Do the work described above first: create/edit real files, run real commands. Only once",
    "that is actually done, reply with your FINAL message being exactly one JSON object (no",
    "prose before or after it) reporting truthfully what you did — never the example below",
    "verbatim, and never a field naming a file or command you did not actually touch or run:",
    `{"version":1,"runId":"${runId}","taskId":"${task.id}","attemptId":"${attemptId}",` +
      `"changedPaths":["<files you actually created or edited>"],` +
      `"commandsRun":[{"command":"<a command you actually ran>","outcome":"<its real result>"}],` +
      `"evidencePaths":[],"blockers":["<only if you could not proceed; omit otherwise>"]}`,
    "",
    "If you could not complete the objective, set changedPaths/commandsRun to reflect only",
    "what you actually did (possibly nothing) and explain why in blockers.",
  ].join("\n");
}

async function defaultVerify(): Promise<VerifyOutcome> {
  return { status: "integrated" };
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
  const resolveCwd = options.resolveCwd ?? (() => options.cwd);
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

    if (options.planRevisionHash) {
      if (state.approvedPlanRevision === null) {
        state.approvedPlanRevision = options.planRevisionHash; // running it is the approval
      } else if (state.approvedPlanRevision !== options.planRevisionHash) {
        throw new Error(
          `plan has changed since approval (approved ${state.approvedPlanRevision}, got ${options.planRevisionHash}); re-approve before running`,
        );
      }
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
        const cwd = resolveCwd(task);
        const { sessionId, pid, events } = options.adapter.launch(options.profile, briefing, cwd);
        state.tasks[task.id] = { status: "running", attemptId, sessionId, pid };
        return { task, attemptId, sessionId, events };
      });
      writeState(statePath, state);

      const outcomes = await Promise.all(
        dispatched.map(async ({ task, attemptId, sessionId, events }) => ({
          task,
          attemptId,
          sessionId,
          collected: await collectResult(events),
        })),
      );

      for (const { task, attemptId, sessionId, collected } of outcomes) {
        const runtime = state.tasks[task.id];
        if (runtime.attemptId !== attemptId || runtime.sessionId !== sessionId) {
          continue; // superseded by a newer attempt; ignore this stale result
        }

        if (!collected.ok) {
          runtime.status = "failed";
          continue;
        }

        const result = collected.result;
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

        const outcome = await verify(task, result);
        runtime.status = outcome.status;
        if (outcome.question) runtime.question = outcome.question;
        if (outcome.baseCommit) runtime.baseCommit = outcome.baseCommit;
        if (outcome.headCommit) runtime.headCommit = outcome.headCommit;
      }

      writeState(statePath, state);
    }

    return state;
  } finally {
    releaseLock(lock);
  }
}
