import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generate } from "./build-integrations.mjs";

test("generate() produces .claude/skills/ship, .claude/agents, and a valid plugin.json", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "ship-build-integrations-test-"));
  try {
    generate(outRoot);
    assert.ok(existsSync(join(outRoot, ".claude", "skills", "ship", "SKILL.md")));
    assert.ok(existsSync(join(outRoot, ".claude", "agents", "ship-reviewer.md")));
    assert.ok(existsSync(join(outRoot, ".claude", "agents", "ship-verifier.md")));

    const plugin = JSON.parse(readFileSync(join(outRoot, ".claude-plugin", "plugin.json"), "utf8"));
    assert.equal(plugin.name, "ship");
    assert.deepEqual(plugin.agents, ["./.claude/agents/ship-reviewer.md", "./.claude/agents/ship-verifier.md"]);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});
