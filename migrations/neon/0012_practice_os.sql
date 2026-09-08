-- Milestone: Unified Folio practice OS and exception-driven client portal.
-- Engagements, work items, client requests, request threads, and a
-- token-based client portal access mechanism (no separate client identity
-- system yet; a hashed access link scopes a portal session to one client,
-- the same pattern already used for beta invitation tokens).
--
-- Every parent/child relationship that crosses a tenant boundary is
-- enforced with a composite foreign key against a (id, tenant_column)
-- unique constraint on the parent, not just a plain id FK, so the database
-- itself rejects a row that pairs a client with another client's
-- engagement/work item/bank transaction, or a firm with another firm's
-- client. Not yet applied to production, so this file is edited directly
-- rather than patched with a follow-up migration. Replay-safe.

DO $$ BEGIN
  ALTER TABLE clients
    ADD CONSTRAINT uq_clients_id_firm UNIQUE (id, firm_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE bank_transactions
    ADD CONSTRAINT uq_bank_transactions_id_client UNIQUE (id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS engagements (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  start_date DATE,
  due_date DATE,
  recurrence TEXT,
  assigned_user_id TEXT,
  tax_year INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE engagements
    ADD CONSTRAINT fk_engagements_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE engagements
    ADD CONSTRAINT uq_engagements_id_firm UNIQUE (id, firm_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE engagements
    ADD CONSTRAINT uq_engagements_id_client UNIQUE (id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE engagements
    ADD CONSTRAINT chk_engagement_status CHECK (status IN (
      'planned', 'active', 'waiting_on_client', 'professional_review', 'ready', 'complete', 'archived'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE engagements
    ADD CONSTRAINT chk_engagement_service_type CHECK (service_type IN (
      'bookkeeping', 'monthly_close', 'quarterly_work', 'tax_1040', 'tax_1065',
      'tax_1120', 'tax_1120s', 'payroll_compliance', 'advisory', 'custom'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_engagements_firm_status ON engagements(firm_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_engagements_client ON engagements(client_id);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  engagement_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  work_type TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TIMESTAMPTZ,
  assigned_user_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE work_items
    ADD CONSTRAINT fk_work_items_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_items
    ADD CONSTRAINT fk_work_items_engagement_same_client
    FOREIGN KEY (engagement_id, client_id) REFERENCES engagements(id, client_id) ON DELETE SET NULL (engagement_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_items
    ADD CONSTRAINT uq_work_items_id_firm UNIQUE (id, firm_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE work_items
    ADD CONSTRAINT uq_work_items_id_client UNIQUE (id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_items
    ADD CONSTRAINT chk_work_item_status CHECK (status IN (
      'open', 'in_progress', 'waiting_on_client', 'blocked', 'complete', 'cancelled'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_items
    ADD CONSTRAINT chk_work_item_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_items_firm_status_due ON work_items(firm_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_work_items_client ON work_items(client_id);
CREATE INDEX IF NOT EXISTS idx_work_items_engagement ON work_items(engagement_id) WHERE engagement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_source ON work_items(source_type, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_requests (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  work_item_id TEXT,
  request_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  related_bank_transaction_id TEXT,
  due_at TIMESTAMPTZ,
  created_by_user_id TEXT,
  approved_by_user_id TEXT,
  approved_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  satisfied_at TIMESTAMPTZ,
  next_reminder_at TIMESTAMPTZ,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE client_requests
    ADD CONSTRAINT fk_requests_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_requests
    ADD CONSTRAINT fk_requests_work_item_same_client
    FOREIGN KEY (work_item_id, client_id) REFERENCES work_items(id, client_id) ON DELETE SET NULL (work_item_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_requests
    ADD CONSTRAINT fk_requests_bank_txn_same_client
    FOREIGN KEY (related_bank_transaction_id, client_id) REFERENCES bank_transactions(id, client_id) ON DELETE SET NULL (related_bank_transaction_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_requests
    ADD CONSTRAINT uq_requests_id_firm UNIQUE (id, firm_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE client_requests
    ADD CONSTRAINT uq_requests_id_client UNIQUE (id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_requests
    ADD CONSTRAINT chk_request_type CHECK (request_type IN (
      'missing_receipt', 'transaction_explanation', 'bank_statement', 'w2', '1099', 'k1',
      'prior_year_return', 'organizer_question', 'signature_placeholder', 'tax_document', 'custom'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_requests
    ADD CONSTRAINT chk_request_status CHECK (status IN (
      'draft', 'requested', 'viewed', 'responded', 'satisfied', 'cancelled'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_requests_firm_status ON client_requests(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_client ON client_requests(client_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_reminder_due ON client_requests(next_reminder_at) WHERE status IN ('requested', 'viewed');
CREATE INDEX IF NOT EXISTS idx_requests_bank_txn ON client_requests(related_bank_transaction_id) WHERE related_bank_transaction_id IS NOT NULL;

-- Race-safe exception-to-request idempotency: at most one non-cancelled
-- request may exist per bank transaction. Two concurrent prepare calls
-- race on this index, not on a prior SELECT, so a duplicate is impossible
-- rather than merely unlikely. A cancelled request does not hold the slot,
-- so a replacement request can always be prepared afterward.
CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_active_bank_txn
  ON client_requests(related_bank_transaction_id)
  WHERE related_bank_transaction_id IS NOT NULL AND status != 'cancelled';

CREATE TABLE IF NOT EXISTS request_messages (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_user_id TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $ BEGIN
  ALTER TABLE request_messages
    ADD CONSTRAINT fk_messages_request_same_client
    FOREIGN KEY (request_id, client_id) REFERENCES client_requests(id, client_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $;

DO $ BEGIN
  ALTER TABLE request_messages
    ADD CONSTRAINT fk_messages_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $;

DO $$ BEGIN
  ALTER TABLE request_messages
    ADD CONSTRAINT chk_message_author_type CHECK (author_type IN ('professional', 'client', 'system'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_request_messages_request ON request_messages(request_id, created_at);

ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS client_visible BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE client_documents
    ADD CONSTRAINT fk_documents_request_same_client
    FOREIGN KEY (request_id, client_id) REFERENCES client_requests(id, client_id) ON DELETE SET NULL (request_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_request ON client_documents(request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_portal_links (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE client_portal_links
    ADD CONSTRAINT fk_portal_links_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_portal_links_client ON client_portal_links(client_id);

CREATE TABLE IF NOT EXISTS service_templates (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_audit_events (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_audit_entity ON work_audit_events(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_work_audit_firm ON work_audit_events(firm_id, created_at DESC);
