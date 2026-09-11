// `ship plan` per plan §4: a small task produces no artifacts; a medium/large
// task renders plan.md, launch-tasks.md, tasks.json, and a Mermaid diagram
// from one already-authored task graph. The planning intelligence (deciding
// what the tasks *are*) lives in the calling skill's reasoning, not here —
// this module is the deterministic renderer + validator + revision hash.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateGraph } from "./state.js";
import type { Task, TaskGraph } from "./types.js";

export type PlanSize = "small" | "medium" | "large";

export interface PlanInput {
  goal: string;
  size: PlanSize;
  requirements?: string[];
  constraints?: string[];
  decisions?: string[];
  scopeBoundaries?: string[];
  risks?: string[];
  acceptanceCriteria?: string[];
  verificationStrategy?: string;
  mergePolicy?: string;
  /** Required for "medium" and "large"; a small task has no graph and no artifacts. */
  graph?: TaskGraph;
}

export interface PlanArtifacts {
  planDir: string;
  planPath: string;
  launchTasksPath: string;
  tasksJsonPath: string;
  revisionHash: string;
}

export type PlanResult = { size: "small" } | ({ size: "medium" | "large" } & PlanArtifacts);

function list(items: string[] | undefined, empty: string): string {
  if (!items || items.length === 0) return empty;
  return items.map((i) => `- ${i}`).join("\n");
}

export function renderMermaid(graph: TaskGraph): string {
  const lines = ["flowchart TD"];
  for (const task of graph.tasks) {
    lines.push(`    ${task.id}["${task.id}: ${task.objective.replace(/"/g, "'")}"]`);
  }
  for (const task of graph.tasks) {
    for (const dep of task.dependsOn) {
      lines.push(`    ${dep} --> ${task.id}`);
    }
  }
  return ["```mermaid", ...lines, "```"].join("\n");
}

export function renderPlanMarkdown(input: PlanInput): string {
  const graph = input.graph as TaskGraph;
  return [
    `# Plan: ${input.goal}`,
    "",
    "## Requirements",
    list(input.requirements, "(none recorded)"),
    "",
    "## Constraints",
    list(input.constraints, "(none recorded)"),
    "",
    "## Decisions",
    list(input.decisions, "(none recorded)"),
    "",
    "## Scope boundaries",
    list(input.scopeBoundaries, "(none recorded)"),
    "",
    "## Risks",
    list(input.risks, "(none recorded)"),
    "",
    "## Acceptance criteria",
    list(input.acceptanceCriteria, "(none recorded)"),
    "",
    "## Verification strategy",
    input.verificationStrategy ?? "(none recorded)",
    "",
    "## Merge policy",
    input.mergePolicy ?? "(none recorded)",
    "",
    "## Dependency diagram",
    renderMermaid(graph),
    "",
  ].join("\n");
}

function taskSection(task: Task): string {
  return [
    `### ${task.id}`,
    "",
    `**Objective:** ${task.objective}`,
    `**Type:** ${task.type}`,
    `**Depends on:** ${task.dependsOn.join(", ") || "(none)"}`,
    `**Owned paths:** ${task.ownedPaths.join(", ") || "(none declared)"}`,
    task.role ? `**Role:** ${task.role}` : undefined,
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function renderLaunchTasksMarkdown(input: PlanInput): string {
  const graph = input.graph as TaskGraph;
  return [`# Launch tasks: ${input.goal}`, "", ...graph.tasks.map(taskSection)].join("\n");
}

/** A revision changes if and only if anything a re-approval should care about changes. */
export function revisionHash(input: PlanInput): string {
  const canonical = JSON.stringify({
    goal: input.goal,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    graph: input.graph ?? null,
    mergePolicy: input.mergePolicy ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Renders plan artifacts for a medium/large plan. A small task writes nothing
 * — plan §4: "no planning document." Throws if the graph is invalid; nothing
 * is written until validation passes.
 */
export function writePlan(plansRoot: string, runId: string, input: PlanInput): PlanResult {
  if (input.size === "small") return { size: "small" };

  if (!input.graph) {
    throw new Error(`a ${input.size} plan requires a task graph`);
  }
  validateGraph(input.graph);

  const planDir = join(plansRoot, runId);
  mkdirSync(planDir, { recursive: true });

  const planPath = join(planDir, "plan.md");
  const launchTasksPath = join(planDir, "launch-tasks.md");
  const tasksJsonPath = join(planDir, "tasks.json");

  writeFileSync(planPath, renderPlanMarkdown(input));
  writeFileSync(launchTasksPath, renderLaunchTasksMarkdown(input));
  writeFileSync(tasksJsonPath, JSON.stringify(input.graph, null, 2));

  return {
    size: input.size,
    planDir,
    planPath,
    launchTasksPath,
    tasksJsonPath,
    revisionHash: revisionHash(input),
  };
}
