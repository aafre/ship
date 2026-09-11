import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd as processCwd, execPath } from "node:process";
import { test } from "node:test";
import type { Event } from "./claude.js";
import { buildArgs, cancel, launch, probe } from "./claude.js";
import type { Profile } from "../types.js";

const profile: Profile = { version: 1, runtime: "claude", model: "sonnet" };

function fixture(name: string): string {
  return join(processCwd(), "fixtures", "adapters", name);
}

async function collect(events: AsyncIterable<Event>): Promise<Event[]> {
  const out: Event[] = [];
  for await (const e of events) out.push(e);
  return out;
}

test("buildArgs never builds a shell string, always an argument array with explicit model and session id", () => {
  const args = buildArgs(profile, "do the thing", "session-123");
  assert.deepEqual(args, [
    "-p",
    "do the thing",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "sonnet",
    "--session-id",
    "session-123",
    "--permission-mode",
    "bypassPermissions",
  ]);
});

test("launch normalizes a representative stream and surfaces the final result", async () => {
  const { events, sessionId, pid } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("representative.mjs")],
  });
  assert.ok(pid > 0);
  assert.ok(sessionId);

  const collected = await collect(events);
  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["system", "assistant", "result"]);
  assert.equal((collected[2].raw as { is_error: boolean }).is_error, false);
});

test("launch flags a truncated stream (clean exit, no result line) as incomplete", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("truncated.mjs")],
  });
  const collected = await collect(events);
  assert.equal(collected.at(-1)?.type, "adapter_incomplete_stream");
});

test("launch preserves a malformed line as its own event without losing the rest of the stream", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("malformed-line.mjs")],
  });
  const collected = await collect(events);
  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["system", "adapter_malformed_line", "result"]);
});

test("launch surfaces a nonzero exit as its own event", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("nonzero-exit.mjs")],
  });
  const collected = await collect(events);
  assert.equal(collected.at(-1)?.type, "adapter_nonzero_exit");
  assert.equal((collected.at(-1)?.raw as { exitCode: number }).exitCode, 1);
});

test("launch surfaces a missing executable as a spawn error, never as a successful result", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: join(tmpdir(), "definitely-not-a-real-claude-binary"),
  });
  const collected = await collect(events);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].type, "adapter_spawn_error");
});

test("cancel kills a running session before it finishes on its own", async () => {
  const { events, sessionId } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("slow.mjs")],
  });

  const collected: Event[] = [];
  const iterator = events[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (!first.done) collected.push(first.value);

  const start = Date.now();
  cancel(sessionId);

  let next = await iterator.next();
  while (!next.done) {
    collected.push(next.value);
    next = await iterator.next();
  }
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 5000, `cancel should stop the worker well before its own 8s timer; took ${elapsed}ms`);
  assert.ok(
    !collected.some((e) => e.type === "result"),
    "a cancelled worker must not report a successful result",
  );
});

test("launch respects a cwd containing a space", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ship cli test ")));
  const { events } = launch(profile, "briefing", dir, {
    command: execPath,
    args: [fixture("report-cwd.mjs")],
  });
  const collected = await collect(events);
  const init = collected.find((e) => e.type === "system")?.raw as { cwd: string };
  assert.equal(realpathSync(init.cwd), dir);
});

test("probe reports available when the runtime starts and completes cleanly", async () => {
  const capabilities = await probe(profile, processCwd(), {
    command: execPath,
    args: [fixture("representative.mjs")],
  });
  assert.equal(capabilities.capabilities.claude.status, "available");
  assert.ok(capabilities.capabilities.claude.evidence);
});

test("probe reports unavailable when the runtime fails before producing a result", async () => {
  const capabilities = await probe(profile, processCwd(), {
    command: execPath,
    args: [fixture("nonzero-exit.mjs")],
  });
  assert.equal(capabilities.capabilities.claude.status, "unavailable");
});
