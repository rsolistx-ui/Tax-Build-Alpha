-- Milestone 4: Canonical Ledger + Periods + Classification
-- Creates the canonical ledger table, period model, and adds classification fields to bank_transactions.
-- Replay-safe: uses IF NOT EXISTS for types, handles enum value additions.

-- 1. Accounting classes for transaction classification
DO $$ BEGIN
    CREATE TYPE accounting_class AS ENUM (
      'expense',
      'income',
      'transfer',
      'owner_contribution',
      'owner_draw',
      'needs_review'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Business/Personal treatment (separate from accounting class)
DO $$ BEGIN
    CREATE TYPE treatment_type AS ENUM (
      'business',
      'personal'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Canonical ledger entries - single authoritative source for book activity
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_key VARCHAR(7) NOT NULL, -- YYYY-MM format
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  accounting_class accounting_class NOT NULL DEFAULT 'needs_review',
  treatment treatment_type NOT NULL DEFAULT 'business',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  source_bank_transaction_id TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL,
  source_receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id TEXT,
  closed_at TIMESTAMPTZ,
  closed_by_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_client_period ON ledger_entries(client_id, period_key, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_client_class ON ledger_entries(client_id, accounting_class, treatment);
CREATE INDEX IF NOT EXISTS idx_ledger_source_bank ON ledger_entries(source_bank_transaction_id) WHERE source_bank_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_source_receipt ON ledger_entries(source_receipt_id) WHERE source_receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_category ON ledger_entries(category_id) WHERE category_id IS NOT NULL;

-- Uniqueness: a bank transaction can own at most one canonical ledger entry
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_source_bank ON ledger_entries(source_bank_transaction_id) WHERE source_bank_transaction_id IS NOT NULL;
-- Uniqueness: a receipt can own at most one canonical ledger entry (when not also sourced from bank)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_source_receipt ON ledger_entries(source_receipt_id) WHERE source_receipt_id IS NOT NULL;

-- 4. Period close state table
CREATE TABLE IF NOT EXISTS accounting_periods (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_key VARCHAR(7) NOT NULL, -- YYYY-MM
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
  closed_at TIMESTAMPTZ,
  closed_by_user_id TEXT,
  reopened_at TIMESTAMPTZ,
  reopened_by_user_id TEXT,
  reopened_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, period_key)
);
CREATE INDEX IF NOT EXISTS idx_periods_client_state ON accounting_periods(client_id, state);

-- 5. Add classification fields to bank_transactions
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS accounting_class accounting_class;
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS treatment treatment_type;
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS period_key VARCHAR(7);
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS classified_by_user_id TEXT;

-- 6. Add classification fields to receipts (for receipt-only ledger entries)
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS accounting_class accounting_class;
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS treatment treatment_type;
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS period_key VARCHAR(7);

-- 7. Add period_key to bank_transactions for import-time period assignment
-- (already added above)

-- 8. Audit event actions for ledger mutations
-- These are tracked via the existing audit_events table
-- Key actions:
-- - ledger_entry_created
-- - ledger_entry_classified
-- - ledger_entry_category_changed
-- - ledger_entry_deleted (soft - only allowed in open periods)
-- - period_closed
-- - period_reopened