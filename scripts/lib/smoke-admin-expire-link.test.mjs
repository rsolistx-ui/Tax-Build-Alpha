// Content-based tests for the expire-portal-link smoke-admin operation:
// no live database is available in this sandbox, so this verifies the
// narrow-scope safety checks and non-secret-leakage properties exist in
// source, and that the production smoke script actually exercises the
// live-expiry path end to end, rather than skipping it as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const smokeAdminSrc = readFileSync(join(__dirname, "..", "smoke-admin.mjs"), "utf8");
const smokeProductionSrc = readFileSync(join(__dirname, "..", "smoke-production.ps1"), "utf8");

test("smoke-admin.mjs implements expire-portal-link as a distinct command", () => {
  assert.match(smokeAdminSrc, /command === "expire-portal-link"/);
});

test("expire-portal-link refuses to operate outside the synthetic smoke-test firm naming convention", () => {
  const idx = smokeAdminSrc.indexOf('command === "expire-portal-link"');
  assert.ok(idx !== -1);
  const body = smokeAdminSrc.slice(idx, idx + 2000);
  assert.match(body, /ALLOWED_SMOKE_FIRM_NAMES/);
  assert.match(body, /refusing to expire a portal link outside the synthetic smoke-test firm naming convention/);
});

test("expire-portal-link never logs a plaintext portal token", () => {
  const idx = smokeAdminSrc.indexOf('command === "expire-portal-link"');
  const nextCommandIdx = smokeAdminSrc.indexOf("} else if (command ===", idx + 1);
  const endIdx = nextCommandIdx === -1 ? smokeAdminSrc.indexOf("} else {", idx) : nextCommandIdx;
  const body = smokeAdminSrc.slice(idx, endIdx);
  assert.doesNotMatch(body, /token_hash/i, "must not select or expose token_hash");
  assert.doesNotMatch(body, /console\.(log|error)\(.*token/i, "must never log anything containing the word token from a real value");
});

test("expire-portal-link backdates expires_at rather than deleting the row or exposing a generic destructive SQL interface", () => {
  const idx = smokeAdminSrc.indexOf('command === "expire-portal-link"');
  const body = smokeAdminSrc.slice(idx, idx + 2000);
  assert.match(body, /UPDATE client_portal_links SET expires_at = NOW\(\) - INTERVAL/);
  const deletePattern = new RegExp("DELETE" + " FROM client_portal_links");
  assert.doesNotMatch(body, deletePattern);
});

test("smoke-production.ps1 actually calls expire-portal-link and asserts a 401 from the expired token", () => {
  assert.match(smokeProductionSrc, /expire-portal-link \$posExpiryLinkId/);
  assert.match(smokeProductionSrc, /expiredTokenStatus -ne "401"/);
});

test("smoke-production.ps1 no longer contains the old skipped-expiry disclaimer", () => {
  assert.doesNotMatch(smokeProductionSrc, /is not live-tested here/);
});
