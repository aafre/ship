import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderMermaid, revisionHash, writePlan } from "./plan.js";
import type { PlanInput } from "./plan.js";
import type { Task, TaskGraph } from "./types.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ship-plan-test-"));
}

function task(id: string, dependsOn: string[] = []): Task {
  return { version: 1, id, type: "agent", objective: `do ${id}`, dependsOn, ownedPaths: [`${id}.ts`] };
}

test("a small plan writes no artifacts", () => {
  const plansRoot = tempDir();
  const result = writePlan(plansRoot, "run-1", { goal: "fix a typo", size: "small" });
  assert.deepEqual(result, { size: "small" });
  assert.equal(existsSync(join(plansRoot, "run-1")), false);
});

test("a medium/large plan writes plan.md, launch-tasks.md, and tasks.json from one graph", () => {
  const plansRoot = tempDir();
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B", ["A"])] };
  const input: PlanInput = { goal: "add feature X", size: "medium", graph, acceptanceCriteria: ["X works"] };

  const result = writePlan(plansRoot, "run-1", input);
  if (result.size === "small") throw new Error("unreachable");
  assert.equal(result.size, "medium");

  assert.ok(existsSync(result.planPath));
  assert.ok(existsSync(result.launchTasksPath));
  assert.ok(existsSync(result.tasksJsonPath));

  const savedGraph = JSON.parse(readFileSync(result.tasksJsonPath, "utf8")) as TaskGraph;
  assert.deepEqual(savedGraph, graph);

  const revisionPath = join(result.planDir, "revision.json");
  assert.ok(existsSync(revisionPath), "ship run needs this sibling file to bind approval");
  const savedRevision = JSON.parse(readFileSync(revisionPath, "utf8")) as { revisionHash: string };
  assert.equal(savedRevision.revisionHash, result.revisionHash);
});

test("the rendered diagram's nodes are exactly the tasks.json nodes", () => {
  const graph: TaskGraph = { version: 1, tasks: [task("A"), task("B", ["A"]), task("C", ["A"])] };
  const mermaid = renderMermaid(graph);
  for (const t of graph.tasks) {
    assert.ok(mermaid.includes(`${t.id}["${t.id}:`), `diagram must contain a node for ${t.id}`);
  }
  assert.ok(mermaid.includes("A --> B"));
  assert.ok(mermaid.includes("A --> C"));
});

test("a cyclic graph is rejected before anything is written", () => {
  const plansRoot = tempDir();
  const graph: TaskGraph = { version: 1, tasks: [task("A", ["B"]), task("B", ["A"])] };
  assert.throws(() => writePlan(plansRoot, "run-1", { goal: "impossible", size: "medium", graph }), /cycle/);
  assert.equal(existsSync(join(plansRoot, "run-1")), false);
});

test("a medium/large plan without a graph is rejected", () => {
  const plansRoot = tempDir();
  assert.throws(() => writePlan(plansRoot, "run-1", { goal: "no graph", size: "large" }), /requires a task graph/);
});

test("revisionHash changes when the graph changes, and is stable when nothing does", () => {
  const graph: TaskGraph = { version: 1, tasks: [task("A")] };
  const input: PlanInput = { goal: "g", size: "medium", graph };
  const first = revisionHash(input);
  const same = revisionHash({ ...input });
  assert.equal(first, same);

  const changedGraph: TaskGraph = { version: 1, tasks: [task("A"), task("B")] };
  const changed = revisionHash({ ...input, graph: changedGraph });
  assert.notEqual(first, changed);
});
