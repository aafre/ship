// Config precedence per plan §2: built-in defaults -> user -> repo -> explicit
// run flags. Personal preferences live in the OS user config directory;
// repo overrides in .ship/config.json. Never stores credentials — this module
// doesn't define a field for one, so there's nothing to accidentally persist.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RoleModels {
  orchestrator?: string;
  planner?: string;
  implementer?: string;
  reviewer?: string;
  verifier?: string;
}

export interface ShipConfig {
  models: RoleModels;
  concurrency: number;
  mergeMethod: "merge" | "squash" | "rebase";
}

export const DEFAULT_CONFIG: ShipConfig = {
  models: {},
  concurrency: 4,
  mergeMethod: "merge",
};

export function userConfigPath(): string {
  const base = process.env.APPDATA ?? join(homedir(), ".config");
  return join(base, "ship", "config.json");
}

export function repoConfigPath(repoRoot: string): string {
  return join(repoRoot, ".ship", "config.json");
}

function readJsonIfExists(path: string): Partial<ShipConfig> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Partial<ShipConfig>;
}

/** Merges defaults -> user -> repo -> flags. Each layer only overrides what it actually sets. */
export function loadEffectiveConfig(repoRoot: string, flags: Partial<ShipConfig> = {}): ShipConfig {
  const user = readJsonIfExists(userConfigPath());
  const repo = readJsonIfExists(repoConfigPath(repoRoot));

  return {
    ...DEFAULT_CONFIG,
    ...user,
    ...repo,
    ...flags,
    models: { ...DEFAULT_CONFIG.models, ...user.models, ...repo.models, ...flags.models },
  };
}

export interface ModelCheckFailure {
  role: string;
  model: string;
}

/**
 * Validates every explicitly configured model by probing it, never
 * substituting a default for one that fails. Returns the failures instead of
 * throwing so the caller can report all of them, not just the first.
 */
export async function validateModelSelections(
  config: ShipConfig,
  probe: (model: string) => Promise<boolean>,
): Promise<ModelCheckFailure[]> {
  const failures: ModelCheckFailure[] = [];
  for (const [role, model] of Object.entries(config.models)) {
    if (!model) continue;
    if (!(await probe(model))) failures.push({ role, model });
  }
  return failures;
}
