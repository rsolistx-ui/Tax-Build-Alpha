-- Milestone: Wave Financial Import
-- Import job tracking, field mappings, and rollback. Replay-safe.

-- Wave import jobs
CREATE TABLE IF NOT EXISTS wave_import_jobs (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rolled_back')),
  source_type TEXT NOT NULL CHECK (source_type IN ('chart_of_accounts', 'customers', 'vendors', 'invoices', 'bills', 'transactions', 'journal_entries', 'full')),
  source_filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  field_mapping JSONB, -- Column mapping from Wave to Folio
  options JSONB DEFAULT '{}', -- Import options (skip_duplicates, dry_run, etc.)
  result_summary JSONB, -- { created: {}, updated: {}, errors: [] }
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wave_import_firm ON wave_import_jobs(firm_id);
CREATE INDEX IF NOT EXISTS idx_wave_import_status ON wave_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_wave_import_client ON wave_import_jobs(client_id);

-- Import row details (for debugging/retry)
CREATE TABLE IF NOT EXISTS wave_import_rows (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES wave_import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  source_data JSONB NOT NULL, -- Original CSV row
  mapped_data JSONB, -- After field mapping
  target_entity_type TEXT, -- 'client', 'invoice', 'transaction', etc.
  target_entity_id TEXT, -- Created/updated entity ID
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'created', 'updated', 'skipped', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wave_import_rows_job ON wave_import_rows(job_id);
CREATE INDEX IF NOT EXISTS idx_wave_import_rows_status ON wave_import_rows(status);

-- Saved field mappings for reuse
CREATE TABLE IF NOT EXISTS wave_field_mappings (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('chart_of_accounts', 'customers', 'vendors', 'invoices', 'bills', 'transactions', 'journal_entries')),
  mapping JSONB NOT NULL, -- { wave_column: folio_field }
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, source_type, name)
);
CREATE INDEX IF NOT EXISTS idx_wave_field_mappings_firm ON wave_field_mappings(firm_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_wave_import_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_wave_import_jobs_updated_at
  BEFORE UPDATE ON wave_import_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_wave_import_jobs_updated_at();

CREATE OR REPLACE FUNCTION update_wave_import_rows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_wave_import_rows_updated_at
  BEFORE UPDATE ON wave_import_rows
  FOR EACH ROW
  EXECUTE FUNCTION update_wave_import_rows_updated_at();

CREATE OR REPLACE FUNCTION update_wave_field_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_wave_field_mappings_updated_at
  BEFORE UPDATE ON wave_field_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_wave_field_mappings_updated_at();
