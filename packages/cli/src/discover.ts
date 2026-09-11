// First-plan discovery per plan §2: find out what's actually here before
// asking the user anything. Never assumes a tool, guidance file, or command
// exists — every field says what was actually found.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ToolInfo {
  available: boolean;
  version?: string;
}

export interface GuidanceFile {
  path: string;
  content: string;
}

export interface Discovery {
  tools: { claude: ToolInfo; codex: ToolInfo; gh: ToolInfo; git: ToolInfo };
  /** Is repoRoot itself a worktree of another checkout, not the main one? */
  isWorktree: boolean;
  buildCommand?: string;
  testCommand?: string;
  /** Every guidance file found, kept separate — conflicting guidance is surfaced, never silently merged into one blob. */
  guidance: GuidanceFile[];
}

export function probeTool(command: string): ToolInfo {
  try {
    const output = execFileSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { available: true, version: output.trim().split("\n")[0] };
  } catch {
    return { available: false };
  }
}

function readGuidance(repoRoot: string): GuidanceFile[] {
  return ["AGENTS.md", "CLAUDE.md"]
    .map((name) => join(repoRoot, name))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

function readPackageScripts(repoRoot: string): { buildCommand?: string; testCommand?: string } {
  const pkgPath = join(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    return {
      buildCommand: pkg.scripts?.build ? "npm run build" : undefined,
      testCommand: pkg.scripts?.test ? "npm test" : undefined,
    };
  } catch {
    return {}; // malformed package.json isn't this function's problem to raise
  }
}

export function discover(repoRoot: string): Discovery {
  const gitPath = join(repoRoot, ".git");
  const isWorktree = existsSync(gitPath) && statSync(gitPath).isFile();

  return {
    tools: {
      claude: probeTool("claude"),
      codex: probeTool("codex"),
      gh: probeTool("gh"),
      git: probeTool("git"),
    },
    isWorktree,
    ...readPackageScripts(repoRoot),
    guidance: readGuidance(repoRoot),
  };
}
