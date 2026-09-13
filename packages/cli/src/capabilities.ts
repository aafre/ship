// Capability-aware verification per plan §5: route a check to a verifier that
// actually has what it needs, preflight readiness in the launched context
// (not inherited from the parent), and serialize access to shared mutable
// resources (ports, fixtures) instead of racing parallel checks against them.

import { createServer } from "node:net";
import type { CapabilityRecord, CapabilityStatus } from "./types.js";

export interface CheckRequirement {
  id: string;
  requiredCapabilities: string[];
}

export interface VerifierProfile {
  id: string;
  capabilities: Record<string, CapabilityRecord>;
}

/**
 * Picks a verifier whose probed capabilities cover every capability the
 * check requires. "unknown" never counts as satisfying a requirement — a
 * parent process having a browser doesn't prove the launched child does.
 */
export function matchVerifier(check: CheckRequirement, profiles: VerifierProfile[]): VerifierProfile | undefined {
  return profiles.find((profile) =>
    check.requiredCapabilities.every((cap) => profile.capabilities[cap]?.status === "available"),
  );
}

export function capabilityStatus(profile: VerifierProfile, capability: string): CapabilityStatus {
  return profile.capabilities[capability]?.status ?? "unknown";
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

export async function isUrlReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface PreflightResult {
  ready: boolean;
  reasons: string[];
}

export interface PreflightSpec {
  requiredPort?: number;
  requiredUrl?: string;
}

/** Checks readiness in the context the check will actually run in — never inferred from what the parent process has. */
export async function preflight(spec: PreflightSpec): Promise<PreflightResult> {
  const reasons: string[] = [];
  if (spec.requiredPort !== undefined && !(await isPortFree(spec.requiredPort))) {
    reasons.push(`port ${spec.requiredPort} is not free`);
  }
  if (spec.requiredUrl !== undefined && !(await isUrlReachable(spec.requiredUrl))) {
    reasons.push(`${spec.requiredUrl} is not reachable`);
  }
  return { ready: reasons.length === 0, reasons };
}

const resourceLocks = new Map<string, Promise<void>>();

/** Serializes access to a shared mutable resource (a port, a fixture, a device) by key. Concurrent checks on different keys never wait on each other. */
export async function withResourceLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = resourceLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = previous.then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  resourceLocks.set(key, next);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
