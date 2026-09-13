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
    assert.equal(plugin.skills, undefined); // default skills/ dir; an override would register `ship` twice
    assert.deepEqual(plugin.agents, ["./skills/ship/agents/ship-reviewer.md", "./skills/ship/agents/ship-verifier.md"]);

    const marketplace = JSON.parse(readFileSync(join(outRoot, ".claude-plugin", "marketplace.json"), "utf8"));
    assert.equal(marketplace.name, "ship");
    assert.deepEqual(marketplace.plugins.map((p) => [p.name, p.source]), [["ship", "./"]]);
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});
