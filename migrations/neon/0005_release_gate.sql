-- Milestone: Final bookkeeping core release gate.
-- Normalizes legacy default_currency values to uppercase and enforces
-- per-client case-insensitive category name uniqueness so the P&L
-- category resolver (slug OR name match) can never be ambiguous. Replay-safe.

UPDATE client_profiles
SET default_currency = UPPER(default_currency)
WHERE default_currency <> UPPER(default_currency);

-- Merge any pre-existing case-insensitive duplicate category names per
-- client before the unique index is created, so this migration never fails
-- on legacy data. The oldest category (by created_at, then id) wins. Every
-- accounting reference to a losing duplicate is repointed to the winner
-- before the duplicate is removed, including free-text references that are
-- not foreign keys: a receipt's extracted_category, a line item's category
-- text, and a merchant correction rule's remembered category are all
-- rewritten to the winner's canonical slug so no line-item allocation or
-- correction memory is silently lost.
DO $$
DECLARE
  dup RECORD;
  loser RECORD;
  winner_id TEXT;
  winner_slug TEXT;
BEGIN
  FOR dup IN
    SELECT client_id, LOWER(name) AS lower_name
    FROM categories
    GROUP BY client_id, LOWER(name)
    HAVING COUNT(*) > 1
  LOOP
    SELECT id, slug INTO winner_id, winner_slug
    FROM categories
    WHERE client_id = dup.client_id AND LOWER(name) = dup.lower_name
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    FOR loser IN
      SELECT id, slug, name
      FROM categories
      WHERE client_id = dup.client_id AND LOWER(name) = dup.lower_name AND id <> winner_id
    LOOP
      UPDATE receipts SET category_id = winner_id
      WHERE client_id = dup.client_id AND category_id = loser.id;

      UPDATE receipts SET extracted_category = winner_slug
      WHERE client_id = dup.client_id
        AND (LOWER(extracted_category) = LOWER(loser.slug) OR LOWER(extracted_category) = LOWER(loser.name));

      UPDATE receipt_line_items li
      SET category = winner_slug
      FROM receipts r
      WHERE li.receipt_id = r.id AND r.client_id = dup.client_id
        AND (LOWER(li.category) = LOWER(loser.slug) OR LOWER(li.category) = LOWER(loser.name));

      UPDATE bank_transactions SET category_id = winner_id
      WHERE client_id = dup.client_id AND category_id = loser.id;

      UPDATE correction_rules
      SET output_json = jsonb_set(output_json, '{category}', to_jsonb(winner_slug))
      WHERE client_id = dup.client_id
        AND (LOWER(output_json->>'category') = LOWER(loser.slug) OR LOWER(output_json->>'category') = LOWER(loser.name));

      DELETE FROM categories WHERE id = loser.id;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_client_lower_name
  ON categories (client_id, LOWER(name));
