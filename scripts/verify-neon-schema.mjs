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
    label: "idx_bank_unique_receipt_claim (one receipt claimed by at most one bank transaction, across matched and pending states)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_unique_receipt_claim'`,
  },
  {
    label: "chk_bank_single_receipt_relationship (a transaction cannot hold both a matched and a pending receipt relationship)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_single_receipt_relationship'`,
  },
];

// The pre-0007 per-state indexes are superseded by idx_bank_unique_receipt_claim
// and are not required to exist; if either is still present (a deployment that
// has not yet run 0007's DROP INDEX statements), that is reported for
// visibility only and never fails verification on its own.
const optionalLegacyChecks = [
  { label: "idx_bank_unique_matched_receipt (superseded by idx_bank_unique_receipt_claim)", query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_unique_matched_receipt'` },
  { label: "idx_bank_unique_pending_receipt (superseded by idx_bank_unique_receipt_claim)", query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_unique_pending_receipt'` },
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

console.log(`Checking ${optionalLegacyChecks.length} superseded index(es) for visibility only (retained is not required)...`);
for (const check of optionalLegacyChecks) {
  const result = await runQuery(check.query);
  const rows = result?.rows ?? [];
  console.log(`  [${rows.length > 0 ? "RETAINED" : "REMOVED"}] ${check.label}`);
}

if (!allPresent) {
  console.error("Production schema verification failed: one or more required migrations were not applied. Deployment is stopped before the Worker is deployed.");
  process.exit(1);
}

console.log("Production schema verification passed.");
