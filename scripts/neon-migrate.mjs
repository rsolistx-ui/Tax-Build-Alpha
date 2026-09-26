import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { splitSqlStatements } from "./lib/sql-split.mjs";
import { discoverMigrationFiles } from "./lib/discover-migrations.mjs";

const sourceUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL is required.");
const parsed = new URL(sourceUrl);
parsed.hostname = parsed.hostname.replace("-pooler", ""); // DDL must use Neon’s direct endpoint.
const databaseUrl = parsed.toString();
const endpoint = `https://${parsed.hostname.replace(/^[^.]+\./, "api.")}/sql`;
const args = process.argv.slice(2);
const baseline = args.includes("--baseline");
const explicit = args.find((arg) => !arg.startsWith("--"));
if (baseline && explicit) throw new Error("--baseline cannot be combined with an explicit migration.");

async function execute(queries) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "Neon-Connection-String": databaseUrl, "Neon-Raw-Text-Output": "true", "Neon-Batch-Isolation-Level": "Serializable" },
    body: JSON.stringify({ queries }),
  });
  if (!response.ok) throw new Error(`Neon request failed (${response.status}): ${(await response.text()).slice(0, 800)}`);
  return response.json();
}

async function rows(query) {
  const result = await execute([{ query, params: [] }]);
  return result?.results?.[0]?.rows ?? result?.rows ?? [];
}

await execute([{ query: `CREATE TABLE IF NOT EXISTS truepost_schema_migrations (
  filename TEXT PRIMARY KEY, checksum_sha256 CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT NOT NULL, deployment_sha TEXT, execution_kind TEXT NOT NULL CHECK (execution_kind IN ('applied', 'baseline'))
)`, params: [] }]);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations", "neon");
const paths = explicit ? [path.resolve(explicit)] : await discoverMigrationFiles(root);
const migrations = await Promise.all(paths.map(async (file) => ({
  file,
  name: path.basename(file),
  checksum: createHash("sha256").update(await readFile(file, "utf8"), "utf8").digest("hex"),
})));
const existingRows = await rows("SELECT filename, checksum_sha256 FROM truepost_schema_migrations ORDER BY filename");
let ledger = new Map(existingRows.map((row) => [Array.isArray(row) ? row[0] : row.filename, Array.isArray(row) ? row[1] : row.checksum_sha256]));
const legacyRow = (await rows("SELECT to_regclass('public.firms') IS NOT NULL AS exists"))[0];
const legacySchema = Array.isArray(legacyRow) ? legacyRow[0] === true || legacyRow[0] === "t" : legacyRow?.exists === true || legacyRow?.exists === "t";

if (ledger.size === 0 && legacySchema) {
  if (!baseline) throw new Error("Pre-ledger schema detected. Run `npm run db:verify:neon`, then `npm run db:baseline:neon` exactly once.");
  // A baseline is an assertion about the existing production schema. Make the
  // assertion executable: callers cannot skip the complete verifier by calling
  // this runner directly with --baseline.
  execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-neon-schema.mjs"), "--skip-ledger-parity"], {
    stdio: "inherit",
    env: process.env,
  });
  const boundary = migrations.findIndex((migration) => migration.name === "0080_schema_migration_ledger.sql");
  if (boundary < 0) throw new Error("0080_schema_migration_ledger.sql is required for a baseline.");
  const historical = migrations.slice(0, boundary);
  await execute(historical.map((migration) => ({
    query: `INSERT INTO truepost_schema_migrations (filename, checksum_sha256, applied_by, deployment_sha, execution_kind)
            VALUES ($1,$2,$3,$4,'baseline') ON CONFLICT (filename) DO NOTHING`,
    params: [migration.name, migration.checksum, process.env.USERNAME || process.env.USER || "release-automation", process.env.GITHUB_SHA || "local"],
  })));
  console.log(`Recorded ${historical.length} verified historical migration(s) as baseline.`);
  ledger = new Map((await rows("SELECT filename, checksum_sha256 FROM truepost_schema_migrations")).map((row) => [Array.isArray(row) ? row[0] : row.filename, Array.isArray(row) ? row[1] : row.checksum_sha256]));
}

for (const migration of migrations) {
  const recorded = ledger.get(migration.name);
  if (recorded && recorded !== migration.checksum) throw new Error(`Checksum drift in ${migration.name}; create a new migration instead of editing an applied file.`);
}
const pending = migrations.filter((migration) => !ledger.has(migration.name));
for (const migration of pending) {
  const statements = splitSqlStatements(await readFile(migration.file, "utf8")).map((query) => ({ query, params: [] }));
  statements.push({
    query: `INSERT INTO truepost_schema_migrations (filename, checksum_sha256, applied_by, deployment_sha, execution_kind)
            VALUES ($1,$2,$3,$4,'applied')`,
    params: [migration.name, migration.checksum, process.env.USERNAME || process.env.USER || "release-automation", process.env.GITHUB_SHA || "local"],
  });
  console.log(`Applying ${migration.name} (${statements.length - 1} statement(s))...`);
  await execute(statements);
}
console.log(pending.length ? `Applied ${pending.length} migration(s).` : "Neon schema is current; no migrations to apply.");
