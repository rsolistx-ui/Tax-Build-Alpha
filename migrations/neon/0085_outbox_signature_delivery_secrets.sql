-- An encrypted, per-operation signing token lets an uncertain provider retry
-- reuse the exact same link. Plain bearer tokens never enter operation_outbox.
CREATE TABLE IF NOT EXISTS outbox_delivery_secrets (
  outbox_id TEXT PRIMARY KEY REFERENCES operation_outbox(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
