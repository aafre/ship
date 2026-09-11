// gh delivery: read the repo's actual default branch (never assume "main")
// and, when the user opted in, open the final PR from the integrate branch.
// Ship never merges it — that's the user's call (plan §7).

import { execFileSync } from "node:child_process";
import { integrateBranch } from "../git.js";

export interface GhOptions {
  /** Overridable for tests; defaults to the `gh` binary on PATH. */
  command?: string;
  /** Test-only escape hatch: prepended to the real args, e.g. [fixtureScriptPath] when command is a node executable. */
  argsPrefix?: string[];
}

function run(repoRoot: string, args: string[], opts: GhOptions): string {
  const fullArgs = [...(opts.argsPrefix ?? []), ...args];
  return execFileSync(opts.command ?? "gh", fullArgs, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Returns the repository's actual default branch, or undefined if gh is missing, unauthenticated, or the repo has none. */
export function defaultBranch(repoRoot: string, opts: GhOptions = {}): string | undefined {
  try {
    const out = run(repoRoot, ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"], opts);
    return out || undefined;
  } catch {
    return undefined;
  }
}

export type FinalPrResult = { ok: true; url: string } | { ok: false; reason: string };

/** Opens (never merges) the final PR from the integrate branch to the repo's real default branch. */
export function createFinalPr(repoRoot: string, runId: string, opts: GhOptions = {}): FinalPrResult {
  const base = defaultBranch(repoRoot, opts);
  if (!base) {
    return { ok: false, reason: "gh unavailable, unauthenticated, or repo has no default branch" };
  }
  try {
    const url = run(repoRoot, ["pr", "create", "--base", base, "--head", integrateBranch(runId), "--fill"], opts);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
