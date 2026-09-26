-- A replacement signing link is staged before email delivery, then predecessor
-- links are revoked only after delivery is recorded. Versioned key metadata
-- keeps pending rows decryptable through an authentication-secret rotation.
ALTER TABLE outbox_delivery_secrets
  ADD COLUMN IF NOT EXISTS signing_link_id TEXT REFERENCES signature_access_links(id) ON DELETE SET NULL;
ALTER TABLE outbox_delivery_secrets
  ADD COLUMN IF NOT EXISTS key_version TEXT NOT NULL DEFAULT 'legacy-auth-v1';
