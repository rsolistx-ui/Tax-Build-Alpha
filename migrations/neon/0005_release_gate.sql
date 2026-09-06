-- Milestone: Final bookkeeping core release gate.
-- Normalizes legacy default_currency values to uppercase and enforces
-- per-client case-insensitive category name uniqueness so the P&L
-- category resolver (slug OR name match) can never be ambiguous. Replay-safe.

UPDATE client_profiles
SET default_currency = UPPER(default_currency)
WHERE default_currency <> UPPER(default_currency);

-- Merge any pre-existing case-insensitive duplicate category names per
-- client before the unique index is created, so this migration never fails
-- on legacy data. The oldest category (by created_at, then id) wins, and every
-- receipt and bank transaction reference to a losing duplicate is repointed
-- to the winner before the duplicate is removed.
DO $$
DECLARE
  dup RECORD;
  winner_id TEXT;
BEGIN
  FOR dup IN
    SELECT client_id, LOWER(name) AS lower_name
    FROM categories
    GROUP BY client_id, LOWER(name)
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO winner_id
    FROM categories
    WHERE client_id = dup.client_id AND LOWER(name) = dup.lower_name
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    UPDATE receipts SET category_id = winner_id
    WHERE client_id = dup.client_id AND category_id IN (
      SELECT id FROM categories
      WHERE client_id = dup.client_id AND LOWER(name) = dup.lower_name AND id <> winner_id
    );

    UPDATE bank_transactions SET category_id = winner_id
    WHERE client_id = dup.client_id AND category_id IN (
      SELECT id FROM categories
      WHERE client_id = dup.client_id AND LOWER(name) = dup.lower_name AND id <> winner_id
    );

    DELETE FROM categories
    WHERE client_id = dup.client_id AND LOWER(name) = dup.lower_name AND id <> winner_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_client_lower_name
  ON categories (client_id, LOWER(name));
