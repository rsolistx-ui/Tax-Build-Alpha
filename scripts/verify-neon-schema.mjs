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
  {
    label: "beta_invitations table (invitation-only beta registration)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'beta_invitations'`,
  },
  {
    label: "beta_entitlements table (server-authoritative beta access)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'beta_entitlements'`,
  },
  {
    label: "tax_year_readiness table (per-client-year tax preparation readiness, migration 0009)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'tax_year_readiness'`,
  },
  {
    label: "document_checklist_items table (per-client-year tax document checklist, migration 0009)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'document_checklist_items'`,
  },
  {
    label: "client_documents table (general document intake beyond receipts, migration 0009)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'client_documents'`,
  },
  {
    label: "fk_documents_checklist_same_client (a document's checklist match must belong to the same client, migration 0010)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_checklist_same_client'`,
  },
  {
    label: "fk_documents_duplicate_same_client (a document's duplicate target must belong to the same client, migration 0010)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_duplicate_same_client'`,
  },
  {
    // Existence alone is not enough - migration 0010 shipped both FKs with
    // a blanket ON DELETE SET NULL that would try to null the NOT NULL
    // client_id column too. Migration 0011 must have replaced the
    // definition with column-specific SET NULL, so verify the actual
    // constraint definition, not just that a constraint with this name
    // exists.
    label: "fk_documents_checklist_same_client has column-specific ON DELETE SET NULL (migration 0011 - never nulls client_id)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_checklist_same_client' AND pg_get_constraintdef(oid) LIKE '%SET NULL (checklist_item_id)%'`,
  },
  {
    label: "fk_documents_duplicate_same_client has column-specific ON DELETE SET NULL (migration 0011 - never nulls client_id)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_duplicate_same_client' AND pg_get_constraintdef(oid) LIKE '%SET NULL (duplicate_of_document_id)%'`,
  },
  {
    label: "engagements table (practice OS, migration 0012)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'engagements'`,
  },
  {
    label: "work_items table (practice OS, migration 0012)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'work_items'`,
  },
  {
    label: "client_requests table (practice OS, migration 0012)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'client_requests'`,
  },
  {
    label: "request_messages table (practice OS, migration 0012)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'request_messages'`,
  },
  {
    label: "client_portal_links table (practice OS, migration 0012)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'client_portal_links'`,
  },
  {
    label: "service_templates table (practice OS, migration 0012)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'service_templates'`,
  },
  {
    label: "work_audit_events table (practice OS, migration 0012)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'work_audit_events'`,
  },
  {
    label: "uq_clients_id_firm unique constraint (tenant-safety anchor for clients) (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_clients_id_firm'`,
  },
  {
    label: "uq_bank_transactions_id_client unique constraint (tenant-safety anchor for bank_transactions) (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_bank_transactions_id_client'`,
  },
  {
    label: "uq_engagements_id_firm unique constraint (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_engagements_id_firm'`,
  },
  {
    label: "uq_engagements_id_client unique constraint (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_engagements_id_client'`,
  },
  {
    label: "uq_work_items_id_firm unique constraint (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_work_items_id_firm'`,
  },
  {
    label: "uq_work_items_id_client unique constraint (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_work_items_id_client'`,
  },
  {
    label: "uq_requests_id_firm unique constraint (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_requests_id_firm'`,
  },
  {
    label: "uq_requests_id_client unique constraint (migration 0012)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_requests_id_client'`,
  },
  {
    label: "fk_engagements_client_same_firm is a composite tenant-safe FK into clients (migration 0012 - an engagement cannot pair a client with a different firm)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_engagements_client_same_firm' AND pg_get_constraintdef(oid) LIKE '%REFERENCES clients(%,%'`,
  },
  {
    label: "fk_work_items_client_same_firm is a composite tenant-safe FK into clients (migration 0012 - a work item cannot pair a client with a different firm)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_client_same_firm' AND pg_get_constraintdef(oid) LIKE '%REFERENCES clients(%,%'`,
  },
  {
    label: "fk_work_items_engagement_same_client is a composite tenant-safe FK into engagements (migration 0012 - a work item cannot reference another client's engagement)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_engagement_same_client' AND pg_get_constraintdef(oid) LIKE '%REFERENCES engagements(%,%'`,
  },
  {
    label: "fk_requests_client_same_firm is a composite tenant-safe FK into clients (migration 0012 - a request cannot pair a client with a different firm)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_requests_client_same_firm' AND pg_get_constraintdef(oid) LIKE '%REFERENCES clients(%,%'`,
  },
  {
    label: "fk_requests_work_item_same_client is a composite tenant-safe FK into work_items (migration 0012 - a request cannot reference another client's work item)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_requests_work_item_same_client' AND pg_get_constraintdef(oid) LIKE '%REFERENCES work_items(%,%'`,
  },
  {
    label: "fk_requests_bank_txn_same_client is a composite tenant-safe FK into bank_transactions (migration 0012 - a request cannot reference another client's bank transaction)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_requests_bank_txn_same_client' AND pg_get_constraintdef(oid) LIKE '%REFERENCES bank_transactions(%,%'`,
  },
  {
    label: "fk_messages_request_same_client is a composite tenant-safe FK into client_requests (migration 0012 - a message cannot reference another client's request)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_request_same_client' AND pg_get_constraintdef(oid) LIKE '%REFERENCES client_requests(%,%'`,
  },
  {
    label: "fk_documents_request_same_client is a composite tenant-safe FK into client_requests (migration 0012 - a document cannot reference another client's request)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_request_same_client' AND pg_get_constraintdef(oid) LIKE '%REFERENCES client_requests(%,%'`,
  },
  {
    label: "fk_portal_links_client_same_firm is a composite tenant-safe FK into clients (migration 0012 - a portal link cannot pair a client with a different firm)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_portal_links_client_same_firm' AND pg_get_constraintdef(oid) LIKE '%REFERENCES clients(%,%'`,
  },
  {
    label: "fk_work_items_engagement_same_client has column-specific ON DELETE SET NULL (migration 0012 - never nulls the tenant column)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_items_engagement_same_client' AND pg_get_constraintdef(oid) LIKE '%SET NULL (engagement_id)%'`,
  },
  {
    label: "fk_requests_work_item_same_client has column-specific ON DELETE SET NULL (migration 0012 - never nulls the tenant column)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_requests_work_item_same_client' AND pg_get_constraintdef(oid) LIKE '%SET NULL (work_item_id)%'`,
  },
  {
    label: "fk_requests_bank_txn_same_client has column-specific ON DELETE SET NULL (migration 0012 - never nulls the tenant column)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_requests_bank_txn_same_client' AND pg_get_constraintdef(oid) LIKE '%SET NULL (related_bank_transaction_id)%'`,
  },
  {
    label: "fk_documents_request_same_client has column-specific ON DELETE SET NULL (migration 0012 - never nulls the tenant column)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_request_same_client' AND pg_get_constraintdef(oid) LIKE '%SET NULL (request_id)%'`,
  },
  {
    label: "client_requests.due_at column (due-date support for reminders and portal display) (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'client_requests' AND column_name = 'due_at'`,
  },
  {
    label: "client_requests.next_reminder_at column (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'client_requests' AND column_name = 'next_reminder_at'`,
  },
  {
    label: "client_requests.reminder_count column (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'client_requests' AND column_name = 'reminder_count'`,
  },
  {
    label: "client_requests.last_reminded_at column (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'client_requests' AND column_name = 'last_reminded_at'`,
  },
  {
    label: "client_documents.request_id column (evidence-to-request linkage) (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'client_documents' AND column_name = 'request_id'`,
  },
  {
    label: "client_documents.client_visible column (portal document visibility flag) (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'client_documents' AND column_name = 'client_visible'`,
  },
  {
    label: "request_messages.client_id column (tenant column enabling the composite FK to client_requests) (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'request_messages' AND column_name = 'client_id'`,
  },
  {
    label: "request_messages.firm_id column (migration 0012)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'request_messages' AND column_name = 'firm_id'`,
  },
  {
    label: "fk_messages_client_same_firm is a composite tenant-safe FK into clients (migration 0012 - a message cannot pair a client with a different firm)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_client_same_firm' AND pg_get_constraintdef(oid) LIKE '%REFERENCES clients(%,%'`,
  },
  {
    label: "uq_requests_active_bank_txn is a partial unique index enforcing race-safe exception-request idempotency (migration 0012)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'uq_requests_active_bank_txn'`,
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
