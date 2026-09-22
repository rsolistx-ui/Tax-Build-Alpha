-- Legacy import jobs must retain the exact uploaded source file. This makes
-- processing resumable and prevents a filename from being treated as data.
ALTER TABLE wave_import_jobs
  ADD COLUMN IF NOT EXISTS source_storage_key TEXT;

CREATE INDEX IF NOT EXISTS idx_wave_import_jobs_source_storage_key
  ON wave_import_jobs(source_storage_key)
  WHERE source_storage_key IS NOT NULL;
