#!/usr/bin/env node
// Regenerates .claude/skills/ship, .claude/agents/ship-*.md, and
// .claude-plugin/{plugin,marketplace}.json from the canonical sources under skills/ship/.
// `npm run check:drift` runs this into a temp directory and diffs it against
// the checked-in copies; a hand-edit to a generated file fails that check
// instead of silently drifting from the source of truth.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const PLUGIN_MANIFEST = {
  name: "ship",
  description:
    "Disciplined end-to-end engineering workflow: classify, recon, plan when it earns it, implement, verify with the repo's own commands, independent review, triage findings, report with evidence.",
  version: "0.2.1",
  author: { name: "aafre" },
  // No `skills` override: the plugin root is the repo root, so Claude Code auto-discovers
  // skills/ship/ (which carries its own agents/ dir). Listing .claude/skills too would
  // register `ship` twice.
  agents: ["./skills/ship/agents/ship-reviewer.md", "./skills/ship/agents/ship-verifier.md"],
};

// Lets `/plugin marketplace add aafre/ship` then `/plugin install ship@ship` work straight from GitHub.
const MARKETPLACE_MANIFEST = {
  name: "ship",
  owner: { name: "aafre" },
  plugins: [{ name: "ship", source: "./", description: PLUGIN_MANIFEST.description }],
};

function copyClean(src, dest) {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

export function generate(outRoot) {
  copyClean(join(repoRoot, "skills", "ship", "SKILL.md"), join(outRoot, ".claude", "skills", "ship", "SKILL.md"));
  copyClean(join(repoRoot, "skills", "ship", "README.md"), join(outRoot, ".claude", "skills", "ship", "README.md"));
  copyClean(join(repoRoot, "skills", "ship", "references"), join(outRoot, ".claude", "skills", "ship", "references"));

  mkdirSync(join(outRoot, ".claude", "agents"), { recursive: true });
  for (const file of readdirSync(join(repoRoot, "skills", "ship", "agents"))) {
    cpSync(join(repoRoot, "skills", "ship", "agents", file), join(outRoot, ".claude", "agents", file));
  }

  mkdirSync(join(outRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(join(outRoot, ".claude-plugin", "plugin.json"), JSON.stringify(PLUGIN_MANIFEST, null, 2) + "\n");
  writeFileSync(join(outRoot, ".claude-plugin", "marketplace.json"), JSON.stringify(MARKETPLACE_MANIFEST, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generate(repoRoot);
  console.log("Generated .claude/skills/ship, .claude/agents/ship-*.md, .claude-plugin/{plugin,marketplace}.json from skills/ship/.");
}
