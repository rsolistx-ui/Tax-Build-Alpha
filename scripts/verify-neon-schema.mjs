// Verifies that production Neon schema actually reflects every migration
// that is expected to have run, so a missed or partially-applied migration
// fails deployment loudly instead of silently shipping a Worker against a
// stale schema. Never logs DATABASE_URL or any other secret.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to verify the production Neon schema.");
  process.exit(1);
}

const parsed = new URL(databaseUrl);
const apiHost = parsed.hostname.replace(/^[^.]+\./, "api.");
const endpoint = `https://${apiHost}/sql`;

async function runQuery(query) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Neon-Connection-String": databaseUrl,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "true",
    },
    body: JSON.stringify({ query, params: [] }),
  });
  if (!response.ok) {
    throw new Error(`Schema verification query failed with HTTP ${response.status}`);
  }
  return response.json();
}

const checks = [
  {
    label: "idx_categories_client_lower_name (case-insensitive category name uniqueness)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_categories_client_lower_name'`,
  },
  {
    label: "bank_transactions.disposition (bookkeeping disposition, migration 0004)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_transactions' AND column_name = 'disposition'`,
  },
  {
    label: "idx_bank_unique_matched_receipt (one receipt to one matched bank transaction)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_unique_matched_receipt'`,
  },
  {
    label: "idx_bank_unique_pending_receipt (one receipt to one pending bank transaction)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_unique_pending_receipt'`,
  },
];

console.log(`Verifying ${checks.length} required production schema object(s)...`);
let allPresent = true;
for (const check of checks) {
  const result = await runQuery(check.query);
  const rows = result?.rows ?? [];
  const present = rows.length > 0;
  console.log(`  [${present ? "OK" : "MISSING"}] ${check.label}`);
  if (!present) allPresent = false;
}

if (!allPresent) {
  console.error("Production schema verification failed: one or more required migrations were not applied. Deployment is stopped before the Worker is deployed.");
  process.exit(1);
}

console.log("Production schema verification passed.");
