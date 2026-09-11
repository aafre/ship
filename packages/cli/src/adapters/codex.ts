// Codex adapter: launch, observe, and cancel a `codex exec --json` worker.
// Flags verified against the installed `codex-cli` 0.154.0 (see `codex exec --help`)
// and https://learn.chatgpt.com/docs/non-interactive-mode.
//
// Unlike claude, codex mints its own session id (the `thread_id` in the first
// `thread.started` event) — there's no `--session-id` flag to set it ourselves.
// The sessionId this module returns from launch()/hands to cancel() is our own
// bookkeeping token, kept symmetric with the claude adapter's interface; the
// real codex thread_id (for a later `codex exec resume <id>`) is carried as
// evidence in the "thread.started" event instead.
//
// To keep run.ts adapter-agnostic, this module normalizes codex's turn.completed
// / turn.failed into the same terminal `{ type: "result", raw: { is_error, result } }`
// shape the claude adapter produces, rather than inventing a second vocabulary
// run.ts would need to understand.

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { platform } from "node:process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Capabilities, Profile } from "../types.js";
import { resolveWindowsCommand } from "./windows-shim.js";

type Worker = ChildProcessByStdio<null, Readable, Readable>;

export type EventType =
  | "thread.started"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "item.started"
  | "item.completed"
  | "item.updated"
  | "error"
  | "result"
  | "adapter_malformed_line"
  | "adapter_spawn_error"
  | "adapter_nonzero_exit"
  | "adapter_incomplete_stream";

export interface Event {
  type: EventType;
  raw: unknown;
}

export interface LaunchResult {
  sessionId: string;
  pid: number;
  events: AsyncIterable<Event>;
}

export interface LaunchOptions {
  /** Overridable for tests; defaults to the `codex` binary on PATH. */
  command?: string;
  /** Overrides the full argument list built from profile/briefing. Test-only escape hatch. */
  args?: string[];
}

/** Builds the argument array for a headless Codex run. Never a shell string — see plan §6. */
export function buildArgs(profile: Profile, briefing: string): string[] {
  return ["exec", briefing, "--json", "--model", profile.model, "--sandbox", "workspace-write"];
}

const running = new Map<string, Worker>();

export function launch(profile: Profile, briefing: string, cwd: string, opts: LaunchOptions = {}): LaunchResult {
  const sessionId = randomUUID(); // our bookkeeping token; see module comment
  const args = opts.args ?? buildArgs(profile, briefing);

  // Same Windows .cmd-shim issue as the Claude adapter — resolved past it
  // the same way; see windows-shim.ts.
  const resolved = opts.command ? { command: opts.command, prefixArgs: [] } : resolveWindowsCommand("codex");

  const child = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: platform !== "win32",
  }) as Worker;

  running.set(sessionId, child);
  return { sessionId, pid: child.pid ?? -1, events: readEvents(child, sessionId) };
}

function lastAgentMessageText(items: { type?: string; text?: string }[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === "agent_message" && typeof items[i].text === "string") return items[i].text as string;
  }
  return "";
}

async function* readEvents(child: Worker, sessionId: string): AsyncGenerator<Event> {
  const rl = createInterface({ input: child.stdout });
  let sawThreadStarted = false;
  let sawTurnResult = false;
  let spawnError: Error | undefined;
  const completedItems: { type?: string; text?: string }[] = [];

  child.once("error", (err) => {
    spawnError = err;
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        yield { type: "adapter_malformed_line", raw: line };
        continue;
      }

      const raw = parsed as { type?: string; item?: { type?: string; text?: string } };
      const type = raw.type;
      if (type === "thread.started") sawThreadStarted = true;
      if (type === "item.completed" && raw.item) completedItems.push(raw.item);
      yield { type: (type as EventType) ?? "adapter_malformed_line", raw: parsed };

      if (type === "turn.completed") {
        sawTurnResult = true;
        yield { type: "result", raw: { is_error: false, result: lastAgentMessageText(completedItems) } };
      } else if (type === "turn.failed") {
        sawTurnResult = true;
        yield { type: "result", raw: { is_error: true, result: lastAgentMessageText(completedItems) } };
      }
    }
  } finally {
    running.delete(sessionId);
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once("exit", (code) => resolve(code));
  });

  if (spawnError) {
    yield { type: "adapter_spawn_error", raw: { message: spawnError.message } };
  } else if (exitCode !== 0) {
    yield { type: "adapter_nonzero_exit", raw: { exitCode } };
  } else if (!sawThreadStarted || !sawTurnResult) {
    yield { type: "adapter_incomplete_stream", raw: { exitCode } };
  }
}

/** Kills the process tree for a launched session. No-op if the session is unknown or already exited. */
export function cancel(sessionId: string): void {
  const child = running.get(sessionId);
  if (!child || child.pid === undefined) return;
  if (platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  running.delete(sessionId);
}

/**
 * Launches a trivial headless session in the given cwd and records whether the
 * runtime is reachable there. Evidence is the raw thread.started/result event —
 * callers decide what specific capability that implies. Never infers liveness
 * from cumulative token totals.
 */
export async function probe(profile: Profile, cwd: string, opts: LaunchOptions = {}): Promise<Capabilities> {
  const { events } = launch(profile, "reply with exactly the word: ok", cwd, opts);

  let sawThreadStarted = false;
  let success = false;
  let evidence = "";

  for await (const event of events) {
    if (event.type === "thread.started") {
      sawThreadStarted = true;
      evidence = JSON.stringify(event.raw);
    } else if (event.type === "result") {
      const raw = event.raw as { is_error?: boolean };
      success = raw.is_error === false;
      evidence = JSON.stringify(event.raw);
    } else if (event.type === "adapter_spawn_error" || event.type === "adapter_nonzero_exit" || event.type === "adapter_incomplete_stream") {
      evidence = JSON.stringify(event.raw);
    }
  }

  const status = sawThreadStarted && success ? "available" : "unavailable";
  return {
    version: 1,
    probedAt: new Date().toISOString(),
    capabilities: { codex: { status, evidence } },
  };
}
