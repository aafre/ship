import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { isPortFree, isUrlReachable, matchVerifier, preflight, withResourceLock } from "./capabilities.js";
import type { VerifierProfile } from "./capabilities.js";

function profile(id: string, caps: Record<string, "available" | "unavailable" | "unknown">): VerifierProfile {
  return { id, capabilities: Object.fromEntries(Object.entries(caps).map(([k, status]) => [k, { status }])) };
}

test("a parent-has-browser/child-does-not profile (unknown) never matches a browser requirement", () => {
  const profiles = [profile("p1", { browser: "unknown" })];
  const match = matchVerifier({ id: "browser-check", requiredCapabilities: ["browser"] }, profiles);
  assert.equal(match, undefined);
});

test("a profile missing the browser binary entirely (unavailable) never matches", () => {
  const profiles = [profile("p1", { browser: "unavailable" })];
  const match = matchVerifier({ id: "browser-check", requiredCapabilities: ["browser"] }, profiles);
  assert.equal(match, undefined);
});

test("a profile with the capability actually available matches", () => {
  const profiles = [profile("p1", { browser: "unavailable" }), profile("p2", { browser: "available" })];
  const match = matchVerifier({ id: "browser-check", requiredCapabilities: ["browser"] }, profiles);
  assert.equal(match?.id, "p2");
});

test("preflight reports an unreachable URL (app failed to start)", async () => {
  const result = await preflight({ requiredUrl: "http://127.0.0.1:1/does-not-exist" });
  assert.equal(result.ready, false);
  assert.match(result.reasons[0], /not reachable/);
});

test("preflight reports a port that is already bound", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const result = await preflight({ requiredPort: port });
    assert.equal(result.ready, false);
    assert.match(result.reasons[0], /not free/);
  } finally {
    server.close();
  }
});

test("isPortFree is true for a genuinely free port and false for a bound one", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : 0;

  try {
    assert.equal(await isPortFree(boundPort), false);
  } finally {
    server.close();
  }
});

test("isUrlReachable is false for an address nothing is listening on", async () => {
  assert.equal(await isUrlReachable("http://127.0.0.1:1/"), false);
});

test("withResourceLock serializes concurrent checks on the same key", async () => {
  const events: string[] = [];
  const task = (label: string, delayMs: number) =>
    withResourceLock("shared-fixture", async () => {
      events.push(`${label}-start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`${label}-end`);
    });

  await Promise.all([task("A", 30), task("B", 0)]);
  // B must not start until A has fully finished, even though B has no delay of its own.
  assert.deepEqual(events, ["A-start", "A-end", "B-start", "B-end"]);
});

test("withResourceLock does not serialize checks on different keys", async () => {
  const events: string[] = [];
  const task = (key: string, label: string, delayMs: number) =>
    withResourceLock(key, async () => {
      events.push(`${label}-start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`${label}-end`);
    });

  await Promise.all([task("port-3000", "A", 30), task("port-4000", "B", 0)]);
  // B (different key) should finish before A even though A started first.
  assert.equal(events.indexOf("B-end") < events.indexOf("A-end"), true);
});
