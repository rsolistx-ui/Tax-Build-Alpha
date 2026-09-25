-- Balance sheet and cash flow per client. A client's money accounts (bank,
-- savings, credit card, loan) with the balance each held on the books start
-- date; bank transactions are assigned to one. Statements are built from these
-- plus the existing transaction classifications (services/financial-statements.ts).
-- Replay-safe.
CREATE TABLE IF NOT EXISTS client_accounts (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checking', 'savings', 'credit_card', 'loan')),
  -- Cash held (checking, savings) or amount owed (credit card, loan) on the books start date.
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_client_accounts_client_same_firm
    FOREIGN KEY (client_id, firm_id) REFERENCES clients(id, firm_id) ON DELETE CASCADE,
  CONSTRAINT uq_client_accounts_id_client UNIQUE (id, client_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_accounts_name ON client_accounts(client_id, lower(name));

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS account_id TEXT;
-- The account must belong to the same client; deleting it leaves the transactions unassigned.
DO $$ BEGIN
  ALTER TABLE bank_transactions
    ADD CONSTRAINT fk_bank_transactions_account_same_client
    FOREIGN KEY (account_id, client_id) REFERENCES client_accounts(id, client_id) ON DELETE SET NULL (account_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(account_id) WHERE account_id IS NOT NULL;

-- Opening balances are as of the end of this day; statements count activity after it.
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS books_start_date DATE;
