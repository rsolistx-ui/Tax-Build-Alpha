import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(scriptDir, "..");

test("get-smoke-cleanup-token.ps1 never echoes the credential value", async () => {
  const content = await readFile(path.join(scriptsDir, "get-smoke-cleanup-token.ps1"), "utf8");
  assert.doesNotMatch(content, /Write-Host\s+\$env:SMOKE_CLEANUP_TOKEN/i);
  assert.doesNotMatch(content, /Write-Output\s+\$env:SMOKE_CLEANUP_TOKEN/i);
  assert.match(content, /DataProtectionScope\]::CurrentUser/, "expected CurrentUser-scoped DPAPI protection");
  assert.match(content, /function Import-SmokeCleanupToken/);
});

test("store-smoke-cleanup-token.ps1 never accepts the token as a command-line argument", async () => {
  const content = await readFile(path.join(scriptsDir, "store-smoke-cleanup-token.ps1"), "utf8");
  assert.doesNotMatch(content, /param\s*\(\s*\[string\]\s*\$Token/i);
  assert.match(content, /must already be set in the current process environment/i);
  assert.match(content, /DataProtectionScope\]::CurrentUser/);
  assert.doesNotMatch(content, /Write-Host\s+\$env:SMOKE_CLEANUP_TOKEN\b/i);
});

test("store-smoke-cleanup-token.ps1 refuses to fall back to plaintext storage off Windows", async () => {
  const content = await readFile(path.join(scriptsDir, "store-smoke-cleanup-token.ps1"), "utf8");
  assert.match(content, /IsWindows/);
  assert.match(content, /Refusing to fall back to plaintext storage/i);
});

test("smoke-production.ps1 attempts the DPAPI loader before failing fast", async () => {
  const content = await readFile(path.join(scriptsDir, "smoke-production.ps1"), "utf8");
  assert.match(content, /get-smoke-cleanup-token\.ps1/);
  assert.match(content, /Import-SmokeCleanupToken/);
  assert.match(content, /SMOKE_CLEANUP_TOKEN is not set\. Refusing to start/);
});

test("no credential helper script stores a plaintext secret file inside the repository", async () => {
  const files = ["get-smoke-cleanup-token.ps1", "store-smoke-cleanup-token.ps1", "smoke-production.ps1"];
  for (const file of files) {
    const content = await readFile(path.join(scriptsDir, file), "utf8");
    assert.doesNotMatch(content, /Set-Content[^\n]*\.env/i);
    assert.doesNotMatch(content, /Tax Build Alpha[^\n]*secrets/i, `${file} should not point the secret store inside the repository`);
  }
});
