import { readFile } from "node:fs/promises";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy the pooled Neon connection string from the Neon dashboard.");
  process.exit(1);
}

const migrationPath = process.argv[2] || "migrations/neon/0001_married_spine.sql";
const sqlText = await readFile(migrationPath, "utf8");
const statements = sqlText
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean)
  .map((query) => ({ query, params: [] }));

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
  console.error(`Neon migration failed (${response.status})`);
  console.error(await response.text());
  process.exit(1);
}

console.log("Neon married-spine migration applied successfully.");
