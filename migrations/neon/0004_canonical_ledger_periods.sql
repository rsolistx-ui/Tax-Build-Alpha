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

-- Uniqueness at the database level: a receipt can be actively claimed (matched or
-- pending review) by at most one bank transaction, even under concurrent requests.
-- The application-level check in checkReceiptNotAlreadyClaimed is a friendly 409
-- precheck; this index is what actually prevents the race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transactions_claimed_receipt
  ON bank_transactions (client_id, COALESCE(matched_receipt_id, pending_receipt_id))
  WHERE matched_receipt_id IS NOT NULL OR pending_receipt_id IS NOT NULL;

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
-- 9. Backfill: populate the canonical ledger from pre-existing paid-alpha data
-- so filed receipts and resolved bank activity do not disappear from P&L when
-- /pnl switches to reading ledger_entries exclusively. Idempotent: each branch
-- only inserts a row when no ledger_entries row already exists for that
-- source, so replaying this migration after new activity has been recorded
-- through the app is safe and will not create duplicates.

-- 9a. Ensure a period row exists for every period this backfill will touch.
INSERT INTO accounting_periods (client_id, period_key)
SELECT DISTINCT bt.client_id, to_char(bt.txn_date, 'YYYY-MM')
FROM bank_transactions bt
WHERE bt.txn_date IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO accounting_periods (client_id, period_key)
SELECT DISTINCT r.client_id, to_char(r.extracted_date, 'YYYY-MM')
FROM receipts r
WHERE r.status = 'filed' AND r.extracted_date IS NOT NULL
ON CONFLICT DO NOTHING;

-- 9b. Matched bank transactions with a linked receipt -> one merged ledger row.
-- Bank data is authoritative for amount/currency; an accounting_class of
-- needs_review is used unless the bank transaction was already explicitly
-- classified, matching the same rule applied going forward at the API level.
INSERT INTO ledger_entries (
  id, client_id, period_key, entry_date, description, amount, currency,
  accounting_class, treatment, category_id,
  source_bank_transaction_id, source_receipt_id, created_by_user_id
)
SELECT
  'le_' || gen_random_uuid(),
  bt.client_id,
  to_char(bt.txn_date, 'YYYY-MM'),
  bt.txn_date,
  COALESCE(r.extracted_merchant, bt.description),
  ABS(bt.amount),
  bt.currency,
  COALESCE(bt.accounting_class, 'needs_review'),
  COALESCE(bt.treatment, 'business'),
  COALESCE(bt.category_id, r.category_id),
  bt.id,
  bt.matched_receipt_id,
  'system_backfill_0004'
FROM bank_transactions bt
JOIN receipts r ON r.id = bt.matched_receipt_id AND r.client_id = bt.client_id
WHERE bt.triage = 'matched'
  AND bt.matched_receipt_id IS NOT NULL
  AND bt.txn_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
    WHERE le.client_id = bt.client_id
      AND (le.source_bank_transaction_id = bt.id OR le.source_receipt_id = bt.matched_receipt_id)
  );

-- 9c. Bank transactions resolved without a receipt -> bank-only ledger row,
-- needs_review by default until explicitly classified (unless it already was).
INSERT INTO ledger_entries (
  id, client_id, period_key, entry_date, description, amount, currency,
  accounting_class, treatment, category_id,
  source_bank_transaction_id, created_by_user_id
)
SELECT
  'le_' || gen_random_uuid(),
  bt.client_id,
  to_char(bt.txn_date, 'YYYY-MM'),
  bt.txn_date,
  bt.description,
  ABS(bt.amount),
  bt.currency,
  COALESCE(bt.accounting_class, 'needs_review'),
  COALESCE(bt.treatment, 'business'),
  bt.category_id,
  bt.id,
  'system_backfill_0004'
FROM bank_transactions bt
WHERE bt.triage = 'no_receipt_required'
  AND bt.txn_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
    WHERE le.client_id = bt.client_id AND le.source_bank_transaction_id = bt.id
  );

-- 9d. Filed receipts with no bank transaction reference at all -> receipt-only
-- ledger row, defaulting to expense/business (the existing, unchanged
-- contract for receipt-only filings).
INSERT INTO ledger_entries (
  id, client_id, period_key, entry_date, description, amount, currency,
  accounting_class, treatment, category_id,
  source_receipt_id, created_by_user_id
)
SELECT
  'le_' || gen_random_uuid(),
  r.client_id,
  to_char(r.extracted_date, 'YYYY-MM'),
  r.extracted_date,
  COALESCE(r.extracted_merchant, 'Receipt'),
  r.extracted_total,
  COALESCE(r.extracted_currency, 'USD'),
  COALESCE(r.accounting_class, 'expense'),
  COALESCE(r.treatment, 'business'),
  r.category_id,
  r.id,
  'system_backfill_0004'
FROM receipts r
WHERE r.status = 'filed'
  AND r.extracted_date IS NOT NULL
  AND r.extracted_total IS NOT NULL
  AND r.id NOT IN (SELECT matched_receipt_id FROM bank_transactions WHERE matched_receipt_id IS NOT NULL)
  AND r.id NOT IN (SELECT pending_receipt_id FROM bank_transactions WHERE pending_receipt_id IS NOT NULL)
  AND r.id NOT IN (SELECT suggested_receipt_id FROM bank_transactions WHERE suggested_receipt_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
    WHERE le.client_id = r.client_id AND le.source_receipt_id = r.id
  );
