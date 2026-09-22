-- Resumable, firm-scoped R2 multipart upload sessions. Documents are not
-- created until R2 completes, so incomplete uploads cannot appear in a client
-- workspace or be mistaken for evidence.
CREATE TABLE IF NOT EXISTS document_upload_sessions (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL UNIQUE,
  r2_upload_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  expected_size_bytes BIGINT NOT NULL CHECK (expected_size_bytes > 0 AND expected_size_bytes <= 104857600),
  expected_sha256 TEXT NOT NULL CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  part_size_bytes INTEGER NOT NULL CHECK (part_size_bytes >= 5242880),
  uploaded_parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'uploading', 'completed', 'aborted', 'failed')),
  created_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_document_upload_sessions_client ON document_upload_sessions(client_id, status);
CREATE INDEX IF NOT EXISTS idx_document_upload_sessions_expiry ON document_upload_sessions(expires_at) WHERE status IN ('initiated', 'uploading');
