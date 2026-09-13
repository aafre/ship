import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceSatisfies, runCheck } from "./verify.js";
import type { CheckSpec, CommandOutcome } from "./verify.js";
import type { CapabilityRecord } from "./types.js";

function caps(overrides: Record<string, CapabilityRecord["status"]>): Record<string, CapabilityRecord> {
  return Object.fromEntries(Object.entries(overrides).map(([k, status]) => [k, { status }]));
}

test("a missing capability is reported as missing_capability and never run", async () => {
  const spec: CheckSpec = { id: "browser-check", type: "browser", requiredCapabilities: ["browser"], command: ["npx", "playwright", "test"] };
  let ran = false;
  const evidence = await runCheck(spec, {
    capabilities: caps({ browser: "unavailable" }),
    runCommand: async () => {
      ran = true;
      return { exitCode: 0 };
    },
  });
  assert.equal(ran, false);
  assert.equal(evidence.failureClass, "missing_capability");
});

test("a manual check is reported unexecuted, never fabricated as passed", async () => {
  const spec: CheckSpec = { id: "human-signoff", type: "manual", requiredCapabilities: [] };
  const evidence = await runCheck(spec, { capabilities: {}, runCommand: async () => ({ exitCode: 0 }) });
  assert.equal(evidence.failureClass, "unexecuted");
});

test("a real assertion failure is not retried", async () => {
  const spec: CheckSpec = { id: "unit", type: "unit", requiredCapabilities: [], command: ["npm", "test"] };
  let calls = 0;
  const evidence = await runCheck(spec, {
    capabilities: {},
    runCommand: async () => {
      calls++;
      return { exitCode: 1 }; // not marked transient
    },
  });
  assert.equal(calls, 1, "an unchanged assertion must never be rerun to green");
  assert.equal(evidence.failureClass, "assertion");
});

test("an identified transient infrastructure failure is retried up to twice, then reported", async () => {
  const spec: CheckSpec = { id: "integration", type: "integration", requiredCapabilities: [], command: ["npm", "run", "it"] };
  let calls = 0;
  const evidence = await runCheck(spec, {
    capabilities: {},
    runCommand: async () => {
      calls++;
      return { exitCode: 1, transient: true } as CommandOutcome;
    },
  });
  assert.equal(calls, 3, "one initial attempt plus two retries");
  assert.equal(evidence.failureClass, "environment");
  assert.equal(evidence.attempt, 3);
});

test("a transient failure that clears on retry reports success at the attempt that passed", async () => {
  const spec: CheckSpec = { id: "flaky", type: "integration", requiredCapabilities: [], command: ["npm", "run", "it"] };
  let calls = 0;
  const evidence = await runCheck(spec, {
    capabilities: {},
    runCommand: async () => {
      calls++;
      return calls < 2 ? ({ exitCode: 1, transient: true } as CommandOutcome) : { exitCode: 0 };
    },
  });
  assert.equal(evidence.exitCode, 0);
  assert.equal(evidence.attempt, 2);
  assert.equal(evidence.failureClass, undefined);
});

test("unit-test evidence cannot satisfy a browser criterion", async () => {
  const unitSpec: CheckSpec = { id: "unit-suite", type: "unit", requiredCapabilities: [], command: ["npm", "test"] };
  const browserSpec: CheckSpec = { id: "browser-suite", type: "browser", requiredCapabilities: ["browser"] };

  const unitEvidence = await runCheck(unitSpec, { capabilities: {}, runCommand: async () => ({ exitCode: 0 }) });
  assert.equal(evidenceSatisfies(unitSpec, unitEvidence), true);
  assert.equal(evidenceSatisfies(browserSpec, unitEvidence), false);
});
