import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPlanRevisionHash } from "./cli.js";
import { writePlan } from "./plan.js";
import type { TaskGraph } from "./types.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ship-cli-test-"));
}

test("readPlanRevisionHash returns undefined for a hand-written tasks.json with no plan behind it", () => {
  const dir = tempDir();
  const tasksPath = join(dir, "tasks.json");
  writeFileSync(tasksPath, JSON.stringify({ version: 1, tasks: [] }));
  assert.equal(readPlanRevisionHash(tasksPath), undefined);
});

test("readPlanRevisionHash reads the hash ship plan recorded next to tasks.json", () => {
  const plansRoot = tempDir();
  const graph: TaskGraph = {
    version: 1,
    tasks: [{ version: 1, id: "A", type: "agent", objective: "do A", dependsOn: [], ownedPaths: ["a.ts"] }],
  };
  const result = writePlan(plansRoot, "run-1", { goal: "g", size: "medium", graph });
  if (result.size === "small") throw new Error("unreachable");

  assert.equal(readPlanRevisionHash(result.tasksJsonPath), result.revisionHash);
});
