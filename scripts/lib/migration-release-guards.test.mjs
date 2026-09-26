import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the migration runner verifies schema before it can baseline a legacy database", async () => {
  const source = await readFile(path.join(scriptsDir, "neon-migrate.mjs"), "utf8");
  const baseline = source.indexOf("if (ledger.size === 0 && legacySchema)");
  const verifier = source.indexOf("verify-neon-schema.mjs", baseline);
  const insert = source.indexOf("Recorded ${historical.length}", baseline);
  assert.ok(verifier > baseline && verifier < insert);
  assert.match(source.slice(baseline, insert), /--skip-ledger-parity/);
});

test("the standard API deployment runs migration and schema gates first", async () => {
  const pkg = JSON.parse(await readFile(path.join(scriptsDir, "..", "package.json"), "utf8"));
  const deploy = pkg.scripts["deploy:api"];
  assert.match(deploy, /^npm run db:migrate:neon && npm run db:verify:neon &&/);
});
