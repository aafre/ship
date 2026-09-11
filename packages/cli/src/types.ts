// Draft contracts. Expected to change through T03 (minimal run loop); frozen in T04.
// Each type carries its own `version` so a state file written against an old shape
// is rejected instead of silently misread.

export type TaskType = "agent" | "manual";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "implemented"
  | "verified"
  | "integrated"
  | "blocked"
  | "failed"
  | "cancelled";

export interface Task {
  version: 1;
  id: string;
  type: TaskType;
  objective: string;
  dependsOn: string[];
  ownedPaths: string[];
  role?: string;
}

export interface TaskGraph {
  version: 1;
  tasks: Task[];
}

export interface TaskRuntimeState {
  status: TaskStatus;
  attemptId?: string;
  sessionId?: string;
  pid?: number;
  baseCommit?: string;
  headCommit?: string;
  evidencePaths?: string[];
  question?: string;
}

export interface RunState {
  version: 1;
  runId: string;
  approvedPlanRevision: string | null;
  tasks: Record<string, TaskRuntimeState>;
}

export interface Profile {
  version: 1;
  runtime: "claude" | "codex";
  model: string;
  reasoning?: string;
}

export type CapabilityStatus = "available" | "unavailable" | "unknown";

export interface CapabilityRecord {
  status: CapabilityStatus;
  evidence?: string;
}

export interface Capabilities {
  version: 1;
  probedAt: string;
  capabilities: Record<string, CapabilityRecord>;
}

export interface WorkerResult {
  version: 1;
  runId: string;
  taskId: string;
  attemptId: string;
  changedPaths: string[];
  commit?: string;
  commandsRun: { command: string; outcome: string }[];
  evidencePaths: string[];
  blockers?: string[];
}
