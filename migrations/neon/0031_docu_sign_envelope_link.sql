ALTER TABLE docu_sign_envelopes
  ADD COLUMN IF NOT EXISTS signature_request_id TEXT REFERENCES signature_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_docu_sign_envelopes_signature_request ON docu_sign_envelopes(signature_request_id);

-- signature_requests.tabs/sent_at/signed_at/voided_at/void_reason were already
-- written to by doc-versioning.ts route handlers but never migrated, so
-- /send, /void, and /complete would fail on their own UPDATE statements.
ALTER TABLE signature_requests
  ADD COLUMN IF NOT EXISTS tabs JSONB,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;
