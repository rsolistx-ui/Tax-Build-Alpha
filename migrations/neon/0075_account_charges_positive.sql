-- Some card issuers (Amex, Capital One, Discover and others) export charges as
-- positive numbers in a single amount column. Truepost's convention is negative
-- = money out, so imports into an account with this flag have their signs flipped.
-- Replay-safe.
ALTER TABLE client_accounts ADD COLUMN IF NOT EXISTS charges_positive BOOLEAN NOT NULL DEFAULT FALSE;
