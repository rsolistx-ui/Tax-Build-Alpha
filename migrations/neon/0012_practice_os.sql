-- Milestone: Unified Folio practice OS and exception-driven client portal.
-- Engagements, work items, client requests, request threads, and a
-- token-based client portal access mechanism (no separate client identity
-- system yet; a hashed access link scopes a portal session to one client,
-- the same pattern already used for beta invitation tokens). Replay-safe.

CREATE TABLE IF NOT EXISTS engagements (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
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
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
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
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  related_bank_transaction_id TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS request_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES client_requests(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL,
  author_user_id TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE request_messages
    ADD CONSTRAINT chk_message_author_type CHECK (author_type IN ('professional', 'client', 'system'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_request_messages_request ON request_messages(request_id, created_at);

-- Evidence must be a first-class relationship to the work that needed it,
-- not just a folder. A document can now be linked to the client request
-- that produced it, and flagged as visible in the client portal.
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS request_id TEXT REFERENCES client_requests(id) ON DELETE SET NULL;
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS client_visible BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_documents_request ON client_documents(request_id) WHERE request_id IS NOT NULL;

-- Client portal access: a hashed, expiring, revocable link scoped to one
-- client, mirroring the existing beta-invitation token pattern rather than
-- introducing a separate client identity/password system this milestone.
CREATE TABLE IF NOT EXISTS client_portal_links (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_links_client ON client_portal_links(client_id);

-- Service templates: sensible defaults for the three named engagement
-- types, not an arbitrary pipeline builder. A template is a fixed ordered
-- list of work-item titles created alongside a new engagement.
CREATE TABLE IF NOT EXISTS service_templates (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit chain for practice-OS state transitions, mirroring the existing
-- beta_access_events shape so exception -> request -> resolution history
-- stays traceable end to end.
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
