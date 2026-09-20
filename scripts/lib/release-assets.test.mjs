import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicDir = path.join(repoRoot, "apps", "web", "public");
const installerPath = path.join(publicDir, "download", "Truepost_0.1.0_x64-setup.exe");

test("the desktop-download CTA targets a tracked Windows installer", async () => {
  const page = await readFile(path.join(repoRoot, "apps", "web", "src", "pages", "beta-redeem.tsx"), "utf8");
  assert.match(page, /href="\/download\/Truepost_0\.1\.0_x64-setup\.exe"/);
  assert.match(page, /\bdownload\b/);

  const installer = await readFile(installerPath);
  assert.deepEqual([...installer.subarray(0, 2)], [0x4d, 0x5a], "installer must be a Windows PE executable");
  assert.ok((await stat(installerPath)).size > 1_000_000, "installer is unexpectedly small");
});

test("static SPA responses receive the same baseline security headers as API responses", async () => {
  const headers = await readFile(path.join(publicDir, "_headers"), "utf8");
  for (const header of [
    "Content-Security-Policy:",
    "Strict-Transport-Security:",
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Referrer-Policy:",
    "Permissions-Policy:",
  ]) {
    assert.match(headers, new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
