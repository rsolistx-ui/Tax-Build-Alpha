-- apps/api/src/services/reporting.ts getReceiptsAwaitingReview() has always
-- selected receipts.notes, but no migration ever added it -- so the export
-- preview endpoint (and by extension the close-packet/export-center flow)
-- has thrown "column \"notes\" does not exist" on every call. Nothing writes
-- to it yet; this just makes the existing read-path work. Replay-safe.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS notes TEXT;
