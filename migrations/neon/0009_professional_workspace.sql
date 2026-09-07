-- Milestone: Folio professional workspace replacement layer.
-- Tax-year readiness, per-client document checklist, and general document
-- intake beyond receipts. Client profile expansion reuses the existing
-- client_profiles.profile JSONB column rather than adding new columns.
-- Replay-safe.

CREATE TABLE IF NOT EXISTS tax_year_readiness (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, tax_year)
);

DO $$ BEGIN
  ALTER TABLE tax_year_readiness
    ADD CONSTRAINT chk_tax_readiness_status CHECK (status IN (
      'not_started', 'collecting_documents', 'bookkeeping_incomplete',
      'professional_review', 'ready_for_preparation', 'preparation_started', 'complete'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tax_readiness_client ON tax_year_readiness(client_id);

CREATE TABLE IF NOT EXISTS document_checklist_items (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  custom_label TEXT,
  status TEXT NOT NULL DEFAULT 'expected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE document_checklist_items
    ADD CONSTRAINT chk_checklist_status CHECK (status IN ('expected', 'requested', 'received', 'reviewed', 'not_applicable'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_checklist_client_year ON document_checklist_items(client_id, tax_year);

CREATE TABLE IF NOT EXISTS client_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  document_type TEXT NOT NULL DEFAULT 'other',
  tax_year INTEGER,
  document_date DATE,
  source_label TEXT,
  checklist_item_id TEXT REFERENCES document_checklist_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'needs_review',
  duplicate_of_document_id TEXT REFERENCES client_documents(id) ON DELETE SET NULL,
  source_hash TEXT NOT NULL,
  confidence TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ
);

DO $$ BEGIN
  ALTER TABLE client_documents
    ADD CONSTRAINT chk_document_type CHECK (document_type IN (
      'receipt', 'bank_statement', 'tax_document', 'prior_year_return',
      'payroll_document', 'loan_document', 'formation_document', 'other'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE client_documents
    ADD CONSTRAINT chk_document_status CHECK (status IN ('needs_review', 'confirmed', 'duplicate', 'not_needed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_client ON client_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON client_documents(client_id, source_hash);
CREATE INDEX IF NOT EXISTS idx_documents_needs_review ON client_documents(client_id) WHERE status = 'needs_review';
