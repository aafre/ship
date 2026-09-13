import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discover, probeTool } from "./discover.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ship-discover-test-"));
}

test("fresh discovery in a temp repo finds installed tools without guessing at missing ones", () => {
  const repoRoot = tempDir();
  const discovery = discover(repoRoot);

  // git/gh/claude/codex are actually installed on this dev machine.
  assert.equal(discovery.tools.git.available, true);
  assert.ok(discovery.tools.git.version);
  assert.equal(discovery.guidance.length, 0);
  assert.equal(discovery.buildCommand, undefined);
  assert.equal(discovery.testCommand, undefined);
});

test("conflicting guidance files are surfaced separately, never flattened into one", () => {
  const repoRoot = tempDir();
  writeFileSync(join(repoRoot, "AGENTS.md"), "Use tabs.");
  writeFileSync(join(repoRoot, "CLAUDE.md"), "Use spaces.");

  const discovery = discover(repoRoot);
  assert.equal(discovery.guidance.length, 2);
  const contents = discovery.guidance.map((g) => g.content);
  assert.ok(contents.includes("Use tabs."));
  assert.ok(contents.includes("Use spaces."));
});

test("build and test commands are read from package.json scripts, not assumed", () => {
  const repoRoot = tempDir();
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));

  const discovery = discover(repoRoot);
  assert.equal(discovery.testCommand, "npm test");
  assert.equal(discovery.buildCommand, undefined);
});

test("a missing tool is reported unavailable, never fabricated", () => {
  const info = probeTool("definitely-not-a-real-ship-tool-binary");
  assert.deepEqual(info, { available: false });
});
