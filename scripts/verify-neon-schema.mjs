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
    label: "client tax inputs, same-firm (migration 0074)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_client_tax_inputs_client_same_firm'`,
  },
  {
    label: "one home office worksheet per client and year (migration 0074)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_client_tax_inputs_one_home_office'`,
  },
  {
    label: "client money accounts, same-firm (migration 0073)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_client_accounts_client_same_firm'`,
  },
  {
    label: "bank transaction account belongs to the same client (migration 0073)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_bank_transactions_account_same_client'`,
  },
  {
    label: "books start date on the client profile (migration 0073)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'client_profiles' AND column_name = 'books_start_date'`,
  },
  {
    label: "per-member sees-all-clients switch (migration 0072)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'firm_members' AND column_name = 'sees_all_clients'`,
  },
  {
    label: "client_assignments same-firm foreign key (migration 0072)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_client_assignments_client_same_firm'`,
  },
  {
    label: "staff invitations carry firm and role (migration 0071)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'beta_invitations' AND column_name = 'firm_role'`,
  },
  {
    label: "one firm per user (migration 0071)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_firm_members_one_firm_per_user'`,
  },
  {
    label: "category_tax_lines same-firm foreign key (migration 0071)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_category_tax_lines_client_same_firm'`,
  },
  {
    label: "category_tax_lines table (migration 0070)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'category_tax_lines' AND column_name = 'form_line_code'`,
  },
  {
    label: "tax_form_mappings unique per client, not per firm (migration 0069)",
    query: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_form_mappings_firm_id_tax_form_tax_year_form_line_code_key')
            AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tax_mapping_unique')`,
  },
  {
    label: "audit_events entity_type/entity_id columns (migration 0068)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'entity_id'`,
  },
  {
    label: "audit_events accepts firm_id/event/metadata shape (migration 0067)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'metadata'`,
  },
  {
    label: "synthetic cleanup guard on append-only triggers (migration 0066)",
    query: `SELECT 1 FROM pg_proc WHERE proname = 'guard_taxpayer_consent_mutation' AND prosrc LIKE '%truepost.synthetic_cleanup%'`,
  },
  {
    label: "firm_agreements table (service agreement acceptance, migration 0065)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'firm_agreements'`,
  },
  {
    label: "mileage_trips table (IRC § 274(d) mileage log, migration 0064)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'mileage_trips'`,
  },
  {
    label: "taxpayer_consents table (IRC § 7216 consents, migration 0063)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'taxpayer_consents'`,
  },
  {
    label: "taxpayer_consents_guard_update trigger (signed consents can only be revoked, migration 0063)",
    query: `SELECT 1 FROM pg_trigger WHERE tgname = 'taxpayer_consents_guard_update'`,
  },
  {
    label: "consent_requests table (single-use consent links, migration 0063)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'consent_requests'`,
  },
  {
    label: "tax_returns_status_check allows 'voided' (migration 0062 — voidReturn failed on every call before this)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'tax_returns_status_check' AND pg_get_constraintdef(oid) LIKE '%voided%'`,
  },
  {
    label: "efile_authorizations table (IRS 8878/8879 signing, migration 0061)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'efile_authorizations'`,
  },
  {
    label: "efile_authorizations.received_hash column (pen-signed copy review, migration 0061)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'efile_authorizations' AND column_name = 'received_hash'`,
  },
  {
    label: "efile_signature_evidence.taxpayer_pin column (migration 0061)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'efile_signature_evidence' AND column_name = 'taxpayer_pin'`,
  },
  {
    label: "efile_kba_attempts table (3-attempt identity-check rule, migration 0061)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'efile_kba_attempts'`,
  },
  {
    label: "idx_efile_authorizations_live_return_role one-live-authorization index (migration 0061)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_efile_authorizations_live_return_role'`,
  },
  {
    label: "efile_signature_evidence append-only triggers (migration 0061)",
    query: `SELECT 1 FROM pg_trigger WHERE tgname = 'efile_signature_evidence_no_update' AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'efile_signature_evidence_no_delete')`,
  },
  {
    label: "efile_authorization_transition_guard trigger (signed records cannot reopen, migration 0061)",
    query: `SELECT 1 FROM pg_trigger WHERE tgname = 'efile_authorization_transition_guard'`,
  },
  {
    label: "receipts.notes column (migration 0060 — export/preview threw 'column notes does not exist' on every call before this pass)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'receipts' AND column_name = 'notes'`,
  },
  {
    label: "document_classifications table (migration 0059 — was never created by any migration; every receipt upload failed at this final INSERT before this pass)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'document_classifications'`,
  },
  {
    label: "stripe_connect_accounts table (migration 0034 — file had a trailing-period syntax error until this pass, never applied before)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'stripe_connect_accounts'`,
  },
  {
    label: "stripe_customers table (migration 0034)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'stripe_customers'`,
  },
  {
    label: "receipts.is_potential_duplicate column (migration 0040 — referenced a nonexistent 'documents' table until this pass, never applied before)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'receipts' AND column_name = 'is_potential_duplicate'`,
  },
  {
    label: "contractor_w9_records table (1099 radar, migration 0040)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'contractor_w9_records'`,
  },
  {
    label: "time_entries table (time tracking tied to invoicing, migration 0056)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'time_entries'`,
  },
  {
    label: "uq_time_entries_running_per_client one-running-timer-per-client guard (migration 0056)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'uq_time_entries_running_per_client'`,
  },
  {
    label: "clients.pipeline_status column (prospect/engaged/active/inactive, migration 0057)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'pipeline_status'`,
  },
  {
    label: "client_service_subscriptions table (recurring workflow templates, migration 0058)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'client_service_subscriptions'`,
  },
  {
    label: "idx_client_service_subscriptions_due cron lookup index (migration 0058)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_client_service_subscriptions_due'`,
  },
  {
    label: "stripe_connect_oauth_states one-time Standard-account authorization table (migration 0055)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'stripe_connect_oauth_states'`,
  },
  {
    label: "idx_stripe_connect_oauth_states_active single-use Stripe state lookup (migration 0055)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_stripe_connect_oauth_states_active'`,
  },
  {
    label: "bank_connections.provider_item_id webhook identity column (migration 0054)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_connections' AND column_name = 'provider_item_id'`,
  },
  {
    label: "idx_bank_connections_plaid_item provider item lookup (migration 0054)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_connections_plaid_item'`,
  },
  {
    label: "wave_import_jobs.source_storage_key durable R2 source reference (migration 0053)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'wave_import_jobs' AND column_name = 'source_storage_key'`,
  },
  {
    label: "idx_wave_import_jobs_source_storage_key Wave source lookup (migration 0053)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_wave_import_jobs_source_storage_key'`,
  },
  {
    label: "firm_rules dictated-rule scope columns (migration 0052)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name='firm_rules' AND column_name='dictated_prompt'`,
  },
  {
    label: "feature_requests Neon-compatible intake table (migration 0052)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name='feature_requests'`,
  },
  {
    label: "firm_rule_versions immutable policy-history table (migration 0051)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'firm_rule_versions'`,
  },
  {
    label: "firm_rule_versions history lookup index (migration 0051)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'firm_rule_versions_rule_created_idx'`,
  },
  {
    label: "signature_access_links recipient-bound hashed signing-link table (migration 0050)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'signature_access_links'`,
  },
  {
    label: "signature_access_links active-link lookup index (migration 0050)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'signature_access_links_active_idx'`,
  },
  {
    label: "signature_evidence_events append-only native signing evidence ledger (migration 0048)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'signature_evidence_events'`,
  },
  {
    label: "signature evidence mutation guard trigger (migration 0048)",
    query: `SELECT 1 FROM pg_trigger WHERE tgname = 'signature_evidence_no_update' AND NOT tgisinternal`,
  },
  {
    label: "signature_requests.updated_at lifecycle timestamp (migration 0049)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'signature_requests' AND column_name = 'updated_at'`,
  },
  {
    label: "gmail_config encrypted refresh-token columns (migration 0043)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'gmail_config' AND column_name = 'refresh_token_ciphertext'`,
  },
  {
    label: "gmail_oauth_states one-time OAuth state table (migration 0043)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'gmail_oauth_states'`,
  },
  {
    label: "supervisor_heartbeat_runs durable cron execution ledger (migration 0044)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'supervisor_heartbeat_runs'`,
  },
  {
    label: "vendors table for Wave contact migration (migration 0045)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'vendors'`,
  },
  {
    label: "bills table for Wave payable migration (migration 0045)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'bills'`,
  },
  {
    label: "migration_import_records idempotency ledger (migration 0045)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_import_records'`,
  },
  {
    label: "invoices table for native billing and Wave invoice migration (migration 0033)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices'`,
  },
  {
    label: "invoice_lines table for native billing and Wave invoice migration (migration 0033)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_lines'`,
  },
  {
    label: "clients.email contact column for migration and communications (migration 0046)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'email'`,
  },
  {
    label: "clients.phone contact column for migration and communications (migration 0046)",
    query: `SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'phone'`,
  },
  {
    label: "bank_transaction_provider_links replay-safe live-feed projection ledger (migration 0047)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_transaction_provider_links'`,
  },
  {
    label: "idx_bank_provider_links_connection for live-feed review projection (migration 0047)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_provider_links_connection'`,
  },
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
    label: "agent_tasks table (event-driven supervisor, migration 0013)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_tasks'`,
  },
  {
    label: "agent task source/agent idempotency guard (migration 0013)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'uq_agent_tasks_source_agent'`,
  },
  {
    label: "agent tasks tenant-safe client relationship (migration 0013)",
    query: `SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_tasks_client_same_firm'`,
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
  {
    label: "document_upload_sessions table (resumable R2 evidence intake, migration 0042)",
    query: `SELECT 1 FROM information_schema.tables WHERE table_name = 'document_upload_sessions'`,
  },
  {
    label: "idx_document_upload_sessions_expiry (expired multipart upload lookup, migration 0042)",
    query: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_document_upload_sessions_expiry'`,
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
