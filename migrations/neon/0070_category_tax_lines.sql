-- Which tax form line each of a client's categories lands on, per tax year.
-- Feeds the tax software handoff (Schedule C line totals). A missing row means
-- the line is suggested from the category name at read time, never stored as
-- if a preparer had chosen it. Replay-safe.
CREATE TABLE IF NOT EXISTS category_tax_lines (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  form_line_code TEXT NOT NULL,
  set_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, category_id, tax_year)
);
CREATE INDEX IF NOT EXISTS idx_category_tax_lines_client_year ON category_tax_lines(client_id, tax_year);
