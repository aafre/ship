import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadEffectiveConfig, repoConfigPath, validateModelSelections } from "./config.js";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "ship-config-test-"));
}

test("with no config files present, effective config is exactly the defaults", () => {
  const repoRoot = tempRepo();
  assert.deepEqual(loadEffectiveConfig(repoRoot), DEFAULT_CONFIG);
});

test("a repo config overrides only what it sets, defaults fill the rest", () => {
  const repoRoot = tempRepo();
  const configPath = repoConfigPath(repoRoot);
  mkdirSync(join(repoRoot, ".ship"), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ concurrency: 2, models: { implementer: "sonnet" } }));

  const effective = loadEffectiveConfig(repoRoot);
  assert.equal(effective.concurrency, 2);
  assert.equal(effective.mergeMethod, "merge"); // untouched default
  assert.equal(effective.models.implementer, "sonnet");
});

test("explicit flags win over repo config, which wins over defaults", () => {
  const repoRoot = tempRepo();
  mkdirSync(join(repoRoot, ".ship"), { recursive: true });
  writeFileSync(repoConfigPath(repoRoot), JSON.stringify({ concurrency: 2 }));

  const effective = loadEffectiveConfig(repoRoot, { concurrency: 8 });
  assert.equal(effective.concurrency, 8);
});

test("validateModelSelections rejects an unprobeable model instead of substituting a default", async () => {
  const config = { ...DEFAULT_CONFIG, models: { implementer: "not-a-real-model" } };
  const failures = await validateModelSelections(config, async (model) => model !== "not-a-real-model");
  assert.deepEqual(failures, [{ role: "implementer", model: "not-a-real-model" }]);
});

test("validateModelSelections passes cleanly when every configured model probes available", async () => {
  const config = { ...DEFAULT_CONFIG, models: { implementer: "sonnet", reviewer: "opus" } };
  const failures = await validateModelSelections(config, async () => true);
  assert.deepEqual(failures, []);
});
