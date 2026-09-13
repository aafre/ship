#!/usr/bin/env node
// Fails if the checked-in .claude/skills, .claude/agents, or .claude-plugin
// differ from what build-integrations.mjs would generate from skills/ship/.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./build-integrations.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function listFiles(root, dir = root) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    out.push(...(statSync(full).isDirectory() ? listFiles(root, full) : [full]));
  }
  return out;
}

function diffTrees(expectedRoot, actualRoot) {
  const differences = [];
  const expectedFiles = existsSync(expectedRoot)
    ? (statSync(expectedRoot).isDirectory() ? listFiles(expectedRoot) : [expectedRoot])
    : [];
  const actualFiles = existsSync(actualRoot) ? (statSync(actualRoot).isDirectory() ? listFiles(actualRoot) : [actualRoot]) : [];

  const rel = (root, files) => files.map((f) => f.slice(root.length));
  const expectedRel = new Set(rel(expectedRoot, expectedFiles));
  const actualRel = new Set(rel(actualRoot, actualFiles));

  for (const r of expectedRel) if (!actualRel.has(r)) differences.push(`missing from checked-in copy: ${r}`);
  for (const r of actualRel) if (!expectedRel.has(r)) differences.push(`extra in checked-in copy (not generated): ${r}`);
  for (const r of expectedRel) {
    if (!actualRel.has(r)) continue;
    if (!readFileSync(expectedRoot + r).equals(readFileSync(actualRoot + r))) {
      differences.push(`content differs: ${r}`);
    }
  }
  return differences;
}

const scratch = mkdtempSync(join(tmpdir(), "ship-check-drift-"));
try {
  generate(scratch);

  const paths = [".claude/skills/ship", ".claude/agents", ".claude-plugin/plugin.json"];
  let drifted = false;
  for (const path of paths) {
    const differences = diffTrees(join(scratch, path), join(repoRoot, path));
    if (differences.length > 0) {
      drifted = true;
      console.error(`Drift under ${path}:`);
      for (const d of differences) console.error(`  ${d}`);
    }
  }

  if (drifted) {
    console.error(`\nGenerated files have drifted from skills/ship/. Run "npm run build:integrations" and commit the result.`);
    process.exit(1);
  }
  console.log("No drift: generated integrations match skills/ship/.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
