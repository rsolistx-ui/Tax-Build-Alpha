import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitSqlStatements } from "./lib/sql-split.mjs";
import { discoverMigrationFiles } from "./lib/discover-migrations.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy the pooled Neon connection string from the Neon dashboard.");
  process.exit(1);
}

async function applyMigration(migrationPath) {
  const sqlText = await readFile(migrationPath, "utf8");
  const statements = splitSqlStatements(sqlText).map((query) => ({ query, params: [] }));

  const parsed = new URL(databaseUrl);
  const apiHost = parsed.hostname.replace(/^[^.]+\./, "api.");
  const endpoint = `https://${apiHost}/sql`;

  console.log(`Applying ${statements.length} statement(s) from ${migrationPath}...`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Neon-Connection-String": databaseUrl,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "true",
      "Neon-Batch-Isolation-Level": "Serializable",
    },
    body: JSON.stringify({ queries: statements }),
  });

  if (!response.ok) {
    console.error(`Neon migration failed (${response.status}) applying ${migrationPath}`);
    console.error(await response.text());
    return false;
  }
  return true;
}

// An explicit file argument still applies just that one file (useful for a
// manual one-off run). With no argument, every *.sql file in
// migrations/neon is discovered and applied in deterministic filename order
// so a new numbered migration is picked up automatically and can never be
// silently skipped by the deployment path.
const explicitArg = process.argv[2];
let migrationPaths;
if (explicitArg) {
  migrationPaths = [explicitArg];
} else {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(scriptDir, "..", "migrations", "neon");
  migrationPaths = await discoverMigrationFiles(migrationsDir);
  console.log(`Discovered ${migrationPaths.length} migration file(s) in ${migrationsDir}:`);
  for (const migrationPath of migrationPaths) {
    console.log(`  - ${migrationPath}`);
  }
}

for (const migrationPath of migrationPaths) {
  const ok = await applyMigration(migrationPath);
  if (!ok) {
    process.exit(1);
  }
}

console.log("Neon migration(s) applied successfully.");
