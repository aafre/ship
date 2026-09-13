import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd as processCwd, execPath } from "node:process";
import { test } from "node:test";
import type { Event } from "./codex.js";
import { buildArgs, cancel, launch, probe } from "./codex.js";
import type { Profile } from "../types.js";

const profile: Profile = { version: 1, runtime: "codex", model: "gpt-5-codex" };

function fixture(name: string): string {
  return join(processCwd(), "fixtures", "adapters", name);
}

async function collect(events: AsyncIterable<Event>): Promise<Event[]> {
  const out: Event[] = [];
  for await (const e of events) out.push(e);
  return out;
}

test("buildArgs never builds a shell string, always an argument array with an explicit model", () => {
  const args = buildArgs(profile, "do the thing");
  assert.deepEqual(args, ["exec", "do the thing", "--json", "--model", "gpt-5-codex", "--sandbox", "workspace-write"]);
});

test("launch normalizes a representative stream and synthesizes a terminal result event", async () => {
  const { events, sessionId, pid } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("codex-representative.mjs")],
  });
  assert.ok(pid > 0);
  assert.ok(sessionId);

  const collected = await collect(events);
  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["thread.started", "turn.started", "item.completed", "turn.completed", "result"]);
  assert.equal((collected.at(-1)?.raw as { is_error: boolean; result: string }).is_error, false);
  assert.equal((collected.at(-1)?.raw as { is_error: boolean; result: string }).result, "ok");
});

test("launch flags a truncated stream (clean exit, no turn.completed) as incomplete", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("codex-truncated.mjs")],
  });
  const collected = await collect(events);
  assert.equal(collected.at(-1)?.type, "adapter_incomplete_stream");
});

test("launch preserves a malformed line without losing the rest of the stream", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("codex-malformed-line.mjs")],
  });
  const collected = await collect(events);
  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["thread.started", "adapter_malformed_line", "item.completed", "turn.completed", "result"]);
});

test("a turn.failed event surfaces as a synthesized failing result, not a successful one", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("codex-turn-failed.mjs")],
  });
  const collected = await collect(events);
  const result = collected.find((e) => e.type === "result");
  assert.equal((result?.raw as { is_error: boolean }).is_error, true);
});

test("launch surfaces a nonzero exit as its own event", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("codex-nonzero-exit.mjs")],
  });
  const collected = await collect(events);
  assert.equal(collected.at(-1)?.type, "adapter_nonzero_exit");
  assert.equal((collected.at(-1)?.raw as { exitCode: number }).exitCode, 1);
});

test("launch surfaces a missing executable as a spawn error, never as a successful result", async () => {
  const { events } = launch(profile, "briefing", processCwd(), {
    command: join(tmpdir(), "definitely-not-a-real-codex-binary"),
  });
  const collected = await collect(events);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].type, "adapter_spawn_error");
});

test("cancel kills a running session before it finishes on its own", async () => {
  const { events, sessionId } = launch(profile, "briefing", processCwd(), {
    command: execPath,
    args: [fixture("codex-slow.mjs")],
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
  assert.ok(!collected.some((e) => e.type === "result"), "a cancelled worker must not report a successful result");
});

test("launch respects a cwd containing a space", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ship cli codex test ")));
  const { events } = launch(profile, "briefing", dir, {
    command: execPath,
    args: [fixture("codex-report-cwd.mjs")],
  });
  const collected = await collect(events);
  const init = collected.find((e) => e.type === "thread.started")?.raw as { cwd: string };
  assert.equal(realpathSync(init.cwd), dir);
});

test("probe reports available when the runtime starts and completes cleanly", async () => {
  const capabilities = await probe(profile, processCwd(), {
    command: execPath,
    args: [fixture("codex-representative.mjs")],
  });
  assert.equal(capabilities.capabilities.codex.status, "available");
  assert.ok(capabilities.capabilities.codex.evidence);
});

test("probe reports unavailable when the runtime fails before completing a turn", async () => {
  const capabilities = await probe(profile, processCwd(), {
    command: execPath,
    args: [fixture("codex-nonzero-exit.mjs")],
  });
  assert.equal(capabilities.capabilities.codex.status, "unavailable");
});
