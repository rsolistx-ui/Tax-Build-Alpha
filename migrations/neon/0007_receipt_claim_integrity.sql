-- Milestone: Final live database and reconciliation closeout.
-- 0006 enforced uniqueness separately within the matched state and within
-- the pending state, but did not prevent the same receipt from being
-- matched to one bank transaction while also pending on another. The paid
-- alpha allows one receipt to be claimed by at most one bank transaction
-- regardless of which state that claim is in. Before adding the
-- cross-state constraint, every legacy conflict is repaired deterministically
-- and audited so no accounting history is silently discarded. Replay-safe.

-- A single transaction should never carry both a matched and a pending
-- receipt relationship at once. Where that has happened, the matched
-- relationship is preserved (it represents a completed professional
-- decision) and the pending relationship is cleared.
DO $$
DECLARE
  bad_row RECORD;
BEGIN
  FOR bad_row IN
    SELECT * FROM bank_transactions
    WHERE matched_receipt_id IS NOT NULL AND pending_receipt_id IS NOT NULL
  LOOP
    INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
    VALUES (
      'aud_' || md5(random()::text || clock_timestamp()::text || bad_row.id || '_samerow'),
      bad_row.client_id,
      bad_row.matched_receipt_id,
      NULL,
      'bank_duplicate_receipt_match_reopened',
      to_jsonb(bad_row),
      jsonb_build_object(
        'id', bad_row.id,
        'pending_receipt_id', NULL,
        'reason', 'This transaction had both a matched and a pending receipt relationship at once; the matched relationship was preserved and the pending relationship was cleared.'
      )
    );

    UPDATE bank_transactions
    SET pending_receipt_id = NULL
    WHERE id = bad_row.id;
  END LOOP;
END $$;

-- A matched relationship on one transaction always takes precedence over a
-- pending relationship for the same receipt on a different transaction. The
-- displaced transaction is reopened to professional review rather than
-- silently losing its history.
DO $$
DECLARE
  matched_row RECORD;
  pending_row RECORD;
BEGIN
  FOR matched_row IN
    SELECT * FROM bank_transactions WHERE matched_receipt_id IS NOT NULL
  LOOP
    FOR pending_row IN
      SELECT * FROM bank_transactions
      WHERE client_id = matched_row.client_id
        AND pending_receipt_id = matched_row.matched_receipt_id
        AND id <> matched_row.id
    LOOP
      INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
      VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text || pending_row.id || '_crossstate'),
        pending_row.client_id,
        matched_row.matched_receipt_id,
        NULL,
        'bank_duplicate_receipt_match_reopened',
        to_jsonb(pending_row),
        jsonb_build_object(
          'id', pending_row.id,
          'triage', 'needs_review',
          'pending_receipt_id', NULL,
          'reason', 'This receipt is already matched to bank transaction ' || matched_row.id || '; the pending relationship on this transaction was cleared and it was reopened for review.'
        )
      );

      UPDATE bank_transactions
      SET triage = 'needs_review',
          pending_receipt_id = NULL,
          resolution_reason = NULL
      WHERE id = pending_row.id;
    END LOOP;
  END LOOP;
END $$;

-- The two individually-scoped indexes from 0006 are superseded by the
-- expression index below, which is the sole authoritative protection: it
-- covers both states at once, per client, so a receipt claimed anywhere
-- (matched or pending) can never be claimed a second time anywhere else.
DROP INDEX IF EXISTS idx_bank_unique_matched_receipt;
DROP INDEX IF EXISTS idx_bank_unique_pending_receipt;

DO $$ BEGIN
  ALTER TABLE bank_transactions
    ADD CONSTRAINT chk_bank_single_receipt_relationship
    CHECK (matched_receipt_id IS NULL OR pending_receipt_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_unique_receipt_claim
  ON bank_transactions (client_id, COALESCE(matched_receipt_id, pending_receipt_id))
  WHERE matched_receipt_id IS NOT NULL OR pending_receipt_id IS NOT NULL;
