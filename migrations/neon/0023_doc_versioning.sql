CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, version)
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id);

CREATE TABLE IF NOT EXISTS signature_requests (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  document_id TEXT,
  envelope_id TEXT,
  form_type TEXT NOT NULL DEFAULT '8879',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','signed','declined','voided')),
  recipients JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sig_req_client ON signature_requests(client_id);
