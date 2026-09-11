-- Records, at extraction time, when Folio's merchant memory matched a
-- rule for the receipt's merchant.  The review flow shows the professional
-- that a category was remembered only when this field is set: a fresh
-- category a professional types is a correction Folio learns from, never
-- a memory being claimed after the fact.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS remembered_category TEXT;