// Claude adapter: launch, observe, and cancel a `claude -p` worker.
// Flags verified against the installed `claude` 2.1.268 (see `claude -p --help`)
// and https://code.claude.com/docs/en/headless.

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { platform } from "node:process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Capabilities, Profile } from "../types.js";

type Worker = ChildProcessByStdio<null, Readable, Readable>;

export type EventType =
  | "system"
  | "assistant"
  | "user"
  | "result"
  | "stream_event"
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
  /** Overridable for tests; defaults to the `claude` binary on PATH. */
  command?: string;
  /** Overrides the full argument list built from profile/briefing/sessionId. Test-only escape hatch. */
  args?: string[];
}

/** Builds the argument array for a headless Claude run. Never a shell string — see plan §6. */
export function buildArgs(profile: Profile, briefing: string, sessionId: string): string[] {
  return [
    "-p",
    briefing,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    profile.model,
    "--session-id",
    sessionId,
    "--permission-mode",
    "bypassPermissions",
  ];
}

const running = new Map<string, Worker>();

export function launch(profile: Profile, briefing: string, cwd: string, opts: LaunchOptions = {}): LaunchResult {
  const command = opts.command ?? "claude";
  const sessionId = randomUUID();
  const args = opts.args ?? buildArgs(profile, briefing, sessionId);

  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: platform !== "win32",
  }) as Worker;

  running.set(sessionId, child);
  return { sessionId, pid: child.pid ?? -1, events: readEvents(child, sessionId) };
}

async function* readEvents(child: Worker, sessionId: string): AsyncGenerator<Event> {
  const rl = createInterface({ input: child.stdout });
  let sawResult = false;
  let spawnError: Error | undefined;
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
      const type = (parsed as { type?: string }).type;
      if (type === "result") sawResult = true;
      yield { type: (type as EventType) ?? "adapter_malformed_line", raw: parsed };
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
  } else if (!sawResult) {
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
 * runtime is reachable there. Evidence is the raw system/init or result event —
 * callers decide what specific capability that implies.
 */
export async function probe(profile: Profile, cwd: string, opts: LaunchOptions = {}): Promise<Capabilities> {
  const { events } = launch(profile, "reply with exactly the word: ok", cwd, opts);

  let sawInit = false;
  let success = false;
  let evidence = "";

  for await (const event of events) {
    if (event.type === "system") {
      const raw = event.raw as { subtype?: string };
      if (raw.subtype === "init") sawInit = true;
      evidence = JSON.stringify(event.raw);
    } else if (event.type === "result") {
      const raw = event.raw as { is_error?: boolean };
      success = raw.is_error === false;
      evidence = JSON.stringify(event.raw);
    } else if (event.type === "adapter_spawn_error" || event.type === "adapter_nonzero_exit" || event.type === "adapter_incomplete_stream") {
      evidence = JSON.stringify(event.raw);
    }
  }

  const status = sawInit && success ? "available" : "unavailable";
  return {
    version: 1,
    probedAt: new Date().toISOString(),
    capabilities: { claude: { status, evidence } },
  };
}
