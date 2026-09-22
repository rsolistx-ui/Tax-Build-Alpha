-- A durable, idempotent landing zone for Wave-origin vendors and payables.
-- Imports always arrive as draft records. They never send invoices, post a
-- journal, or alter a reviewed ledger entry as a side effect of migration.

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, name)
);
CREATE INDEX IF NOT EXISTS idx_vendors_firm_name ON vendors(firm_id, name);

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void', 'overdue')),
  issue_date DATE NOT NULL,
  due_date DATE,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  import_source TEXT,
  import_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, number),
  UNIQUE (firm_id, import_source, import_key)
);
CREATE INDEX IF NOT EXISTS idx_bills_firm_status ON bills(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills(vendor_id);

CREATE TABLE IF NOT EXISTS migration_import_records (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, source, source_type, source_key)
);
CREATE INDEX IF NOT EXISTS idx_migration_import_records_target ON migration_import_records(target_type, target_id);
