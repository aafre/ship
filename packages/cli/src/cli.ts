#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as claude from "./adapters/claude.js";
import { run } from "./run.js";
import { readState } from "./state.js";
import type { Profile, RunState, TaskGraph } from "./types.js";

// ponytail: `plan`, real profile/config discovery, and `.ship/runs/<run-id>`
// resolution land in T06. For now `run`/`status` take the run directory and
// tasks.json path directly.

export function formatStatus(state: RunState): string {
  const lines = Object.entries(state.tasks).map(([taskId, runtime]) => {
    const question = runtime.question ? ` — question: ${runtime.question}` : "";
    return `${taskId}: ${runtime.status}${question}`;
  });
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "run") {
    const [runDir, tasksPath] = rest;
    if (!runDir || !tasksPath) {
      console.error("usage: ship-cli run <runDir> <tasksJsonPath>");
      return 1;
    }
    const graph = JSON.parse(readFileSync(tasksPath, "utf8")) as TaskGraph;
    const profile: Profile = { version: 1, runtime: "claude", model: "sonnet" };
    const state = await run({
      runId: basename(runDir),
      graph,
      runDir,
      cwd: process.cwd(),
      profile,
      adapter: claude,
    });
    console.log(formatStatus(state));
    return 0;
  }

  if (command === "status") {
    const [runDir] = rest;
    if (!runDir) {
      console.error("usage: ship-cli status <runDir>");
      return 1;
    }
    const state = readState(join(runDir, "state.json"));
    console.log(formatStatus(state));
    return 0;
  }

  console.error("usage: ship-cli <run|status> ...");
  return 1;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
