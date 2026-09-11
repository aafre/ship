import type { RunState, Task, TaskGraph } from "./types.js";

export interface SlotConfig {
  implementation: number;
  review: number;
}

export const DEFAULT_SLOTS: SlotConfig = { implementation: 4, review: 2 };

const TERMINAL = new Set(["integrated", "blocked", "failed", "cancelled"]);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

/**
 * Tasks ready to dispatch this cycle: every dependency is integrated, the
 * task itself hasn't started, and a slot is free. validateGraph already
 * rejects any two concurrently-runnable tasks that share an owned path, so
 * the scheduler doesn't need to re-check ownership at runtime.
 */
export function selectReadyTasks(graph: TaskGraph, state: RunState, slots: SlotConfig): Task[] {
  const running = Object.values(state.tasks).filter((t) => t.status === "running").length;
  const freeSlots = Math.max(0, slots.implementation - running);
  if (freeSlots === 0) return [];

  const ready = graph.tasks.filter((task) => {
    const runtime = state.tasks[task.id];
    if (!runtime || (runtime.status !== "pending" && runtime.status !== "ready")) return false;
    return task.dependsOn.every((dep) => state.tasks[dep]?.status === "integrated");
  });

  return ready.slice(0, freeSlots);
}
