// On Windows, npm installs CLI tools (claude, codex) as a .cmd shim.
// child_process.spawn() can't execute a .cmd directly without a shell, and
// shell:true with an argument array is unsafe (Node's own DEP0190: args are
// concatenated, not escaped). The shim just wraps a real binary a few
// directories over, so resolve to that instead and keep spawning it with a
// plain argv array — no shell involved.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { platform } from "node:process";

export interface ResolvedCommand {
  command: string;
  /** Prepended to the caller's own args, e.g. [scriptPath] when the target is a .js file run via node. */
  prefixArgs: string[];
}

/** Extracts the real target path from npm's generated .cmd shim content, e.g. `"%dp0%\node_modules\pkg\bin\tool.exe"   %*`. */
export function parseCmdShimTarget(shimPath: string, content: string): string | undefined {
  const match = content.match(/"%dp0%\\(.+?)"/);
  if (!match) return undefined;
  return join(dirname(shimPath), match[1]);
}

/** Resolves `command` past a Windows .cmd shim to its real target. A no-op (returns command unchanged) off Windows, or when nothing shim-like is found. */
export function resolveWindowsCommand(command: string): ResolvedCommand {
  if (platform !== "win32") return { command, prefixArgs: [] };

  let shimPath: string;
  try {
    shimPath = execFileSync("where", [`${command}.cmd`], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  } catch {
    return { command, prefixArgs: [] };
  }
  if (!shimPath || !existsSync(shimPath)) return { command, prefixArgs: [] };

  const target = parseCmdShimTarget(shimPath, readFileSync(shimPath, "utf8"));
  if (!target || !existsSync(target)) return { command, prefixArgs: [] };

  return extname(target).toLowerCase() === ".exe"
    ? { command: target, prefixArgs: [] }
    : { command: process.execPath, prefixArgs: [target] };
}
