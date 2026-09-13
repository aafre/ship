import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { parseCmdShimTarget } from "./windows-shim.js";

const REAL_NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*
`;

test("parseCmdShimTarget extracts the real binary path from an npm-generated .cmd shim", () => {
  const shimPath = "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd";
  const target = parseCmdShimTarget(shimPath, REAL_NPM_SHIM);
  assert.equal(target, join("C:\\Users\\test\\AppData\\Roaming\\npm", "node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"));
});

test("parseCmdShimTarget returns undefined for content that isn't an npm shim", () => {
  const target = parseCmdShimTarget("C:\\somewhere\\tool.cmd", "@ECHO off\r\necho not an npm shim\r\n");
  assert.equal(target, undefined);
});
