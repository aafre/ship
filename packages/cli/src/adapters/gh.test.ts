import assert from "node:assert/strict";
import { cwd as processCwd, execPath } from "node:process";
import { join } from "node:path";
import { test } from "node:test";
import { createFinalPr, defaultBranch } from "./gh.js";

function fixture(name: string): string {
  return join(processCwd(), "fixtures", "gh", name);
}

test("defaultBranch reads the repo's actual default branch, not an assumed name", () => {
  const branch = defaultBranch(processCwd(), { command: execPath, argsPrefix: [fixture("success.mjs")] });
  assert.equal(branch, "main");
});

test("defaultBranch returns undefined when gh is missing auth", () => {
  const branch = defaultBranch(processCwd(), { command: execPath, argsPrefix: [fixture("no-auth.mjs")] });
  assert.equal(branch, undefined);
});

test("createFinalPr opens a PR against the real default branch", () => {
  const result = createFinalPr(processCwd(), "run-1", { command: execPath, argsPrefix: [fixture("success.mjs")] });
  assert.deepEqual(result, { ok: true, url: "https://github.com/example/example/pull/1" });
});

test("createFinalPr fails cleanly when gh has no auth, without ever assuming a default branch", () => {
  const result = createFinalPr(processCwd(), "run-1", { command: execPath, argsPrefix: [fixture("no-auth.mjs")] });
  assert.equal(result.ok, false);
});
