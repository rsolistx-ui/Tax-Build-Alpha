-- Milestone 5/6: DocuSign Integration
-- OAuth tokens, envelope tracking, templates. Replay-safe.

-- DocuSign OAuth tokens (one per firm per DocuSign account)
CREATE TABLE IF NOT EXISTS docusign_tokens (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,  -- DocuSign account ID
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_docusign_tokens_firm ON docusign_tokens(firm_id);

-- DocuSign envelope tracking
CREATE TABLE IF NOT EXISTS docusign_envelopes (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  envelope_id TEXT NOT NULL UNIQUE,  -- DocuSign envelope ID
  template_id TEXT,
  status TEXT NOT NULL,
  subject TEXT,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_docusign_envelopes_firm ON docusign_envelopes(firm_id);
CREATE INDEX IF NOT EXISTS idx_docusign_envelopes_client ON docusign_envelopes(client_id);
CREATE INDEX IF NOT EXISTS idx_docusign_envelopes_engagement ON docusign_envelopes(engagement_id);
CREATE INDEX IF NOT EXISTS idx_docusign_envelopes_status ON docusign_envelopes(status);
CREATE INDEX IF NOT EXISTS idx_docusign_envelopes_envelope_id ON docusign_envelopes(envelope_id);

-- DocuSign template catalog (firm-specific templates)
CREATE TABLE IF NOT EXISTS docusign_templates (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,  -- DocuSign template ID
  name TEXT NOT NULL,
  description TEXT,
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{roleName, name?, email?, routingOrder?}]
  subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_docusign_templates_firm ON docusign_templates(firm_id);

-- DocuSign webhook events log (for audit/debugging)
CREATE TABLE IF NOT EXISTS docusign_webhook_events (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- 'envelope-completed', 'envelope-declined', etc.
  envelope_id TEXT NOT NULL,
  event_data JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docusign_webhook_firm ON docusign_webhook_events(firm_id);
CREATE INDEX IF NOT EXISTS idx_docusign_webhook_envelope ON docusign_webhook_events(envelope_id);
CREATE INDEX IF NOT EXISTS idx_docusign_webhook_processed ON docusign_webhook_events(processed);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_docusign_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_docusign_tokens_updated_at
  BEFORE UPDATE ON docusign_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_docusign_tokens_updated_at();

CREATE OR REPLACE FUNCTION update_docusign_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_docusign_templates_updated_at
  BEFORE UPDATE ON docusign_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_docusign_templates_updated_at();