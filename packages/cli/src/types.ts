// Frozen as of T04. Each type carries its own `version` so a state file written
// against an old shape is rejected instead of silently misread; a later change
// to any of these bumps that type's version and updates readState/validateGraph
// accordingly rather than reinterpreting old data under a new meaning.

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
  /** Set together at dispatch; a result is only accepted if all three still match (see run.ts). */
  attemptId?: string;
  sessionId?: string;
  pid?: number;
  /** The commit the task's branch/worktree started from and the tip that was merged, once verify() (git.ts) has run. */
  baseCommit?: string;
  headCommit?: string;
  evidencePaths?: string[];
  /** Set when status is "blocked"; printed by `ship status` (cli.ts). */
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

/** What run.ts's pluggable verify step (state.ts's caller) decides after a task reaches "implemented". */
export type VerifyStatus = "integrated" | "blocked" | "failed";

export interface VerifyOutcome {
  status: VerifyStatus;
  /** Required when status is "blocked" — becomes TaskRuntimeState.question. */
  question?: string;
  baseCommit?: string;
  headCommit?: string;
}
