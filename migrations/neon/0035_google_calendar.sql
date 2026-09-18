-- Milestone: Google Calendar Integration
-- OAuth config, event mappings, sync state. Replay-safe.

-- Google Calendar OAuth configuration per firm
CREATE TABLE IF NOT EXISTS google_calendar_config (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT,
  calendar_id TEXT DEFAULT 'primary', -- Google Calendar ID to sync with
  sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_sync_token TEXT, -- For incremental sync
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id)
);
CREATE INDEX IF NOT EXISTS idx_google_cal_config_firm ON google_calendar_config(firm_id);

-- Mapping between Folio deadlines and Google Calendar events
CREATE TABLE IF NOT EXISTS calendar_event_mappings (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  folio_deadline_id TEXT NOT NULL, -- ID of the deadline in Folio (engagement, work_item, tax_extension, invoice)
  folio_deadline_type TEXT NOT NULL CHECK (folio_deadline_type IN ('engagement', 'work_item', 'tax_extension', 'invoice')),
  google_event_id TEXT NOT NULL,
  google_calendar_id TEXT NOT NULL DEFAULT 'primary',
  etag TEXT, -- Google event ETag for change detection
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'conflict', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, folio_deadline_id, folio_deadline_type)
);
CREATE INDEX IF NOT EXISTS idx_cal_mappings_firm ON calendar_event_mappings(firm_id);
CREATE INDEX IF NOT EXISTS idx_cal_mappings_google ON calendar_event_mappings(google_event_id);
CREATE INDEX IF NOT EXISTS idx_cal_mappings_deadline ON calendar_event_mappings(folio_deadline_id, folio_deadline_type);

-- Google OAuth state for CSRF protection
CREATE TABLE IF NOT EXISTS google_oauth_states (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  UNIQUE (state)
);
CREATE INDEX IF NOT EXISTS idx_google_oauth_state ON google_oauth_states(state);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_google_calendar_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_google_calendar_config_updated_at
  BEFORE UPDATE ON google_calendar_config
  FOR EACH ROW
  EXECUTE FUNCTION update_google_calendar_config_updated_at();

CREATE OR REPLACE FUNCTION update_calendar_event_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calendar_event_mappings_updated_at
  BEFORE UPDATE ON calendar_event_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_event_mappings_updated_at();