// Verification per plan §5: planning a check and executing it are separate
// responsibilities. Every result records what ran, on what commit, and
// whether it actually ran at all — never a passed claim without evidence.

import type { CapabilityRecord } from "./types.js";

export type CheckType = "unit" | "static" | "integration" | "browser" | "interactive" | "manual";

export type FailureClass = "assertion" | "environment" | "missing_capability" | "unexecuted";

export interface CheckSpec {
  id: string;
  type: CheckType;
  requiredCapabilities: string[];
  /** Absent for a "manual" check — a human runs it and records the evidence themselves. */
  command?: string[];
  cwd?: string;
}

export interface CheckEvidence {
  checkId: string;
  attempt: number;
  commit?: string;
  command?: string[];
  cwd?: string;
  exitCode?: number;
  logPath?: string;
  screenshotPath?: string;
  /** Present only when the check did not pass. */
  failureClass?: FailureClass;
}

export interface CommandOutcome {
  exitCode: number;
  logPath?: string;
  screenshotPath?: string;
  /** True only for an identified transient infrastructure failure (network blip, flaky port bind) — never for "the assertion failed." */
  transient?: boolean;
}

export interface RunCheckOptions {
  capabilities: Record<string, CapabilityRecord>;
  runCommand: (command: string[], cwd: string) => Promise<CommandOutcome>;
  commit?: string;
  /** Automatic retries for an identified transient failure only. Default 2 (plan §5: "at most two automatic retries"). */
  maxRetries?: number;
}

/**
 * Runs one check, or explains why it didn't. A missing capability or a
 * manual/commandless check never gets a fabricated pass — both come back as
 * "unexecuted" or "missing_capability" instead.
 */
export async function runCheck(spec: CheckSpec, options: RunCheckOptions): Promise<CheckEvidence> {
  const missing = spec.requiredCapabilities.filter((cap) => options.capabilities[cap]?.status !== "available");
  if (missing.length > 0) {
    return { checkId: spec.id, attempt: 0, commit: options.commit, failureClass: "missing_capability" };
  }

  if (spec.type === "manual" || !spec.command) {
    return { checkId: spec.id, attempt: 0, commit: options.commit, failureClass: "unexecuted" };
  }

  const maxRetries = options.maxRetries ?? 2;
  let attempt = 0;
  let outcome: CommandOutcome;
  do {
    attempt++;
    outcome = await options.runCommand(spec.command, spec.cwd ?? process.cwd());
    if (outcome.exitCode === 0) break;
  } while (outcome.transient && attempt <= maxRetries);

  return {
    checkId: spec.id,
    attempt,
    commit: options.commit,
    command: spec.command,
    cwd: spec.cwd,
    exitCode: outcome.exitCode,
    logPath: outcome.logPath,
    screenshotPath: outcome.screenshotPath,
    failureClass: outcome.exitCode === 0 ? undefined : outcome.transient ? "environment" : "assertion",
  };
}

/** A unit-test pass can never stand in for a required browser check — evidence is checked against the requirement it claims to satisfy, not assumed. */
export function evidenceSatisfies(spec: CheckSpec, evidence: CheckEvidence): boolean {
  return evidence.checkId === spec.id && evidence.exitCode === 0 && evidence.failureClass === undefined;
}
