-- Milestone: Bookkeeping core final data-integrity gate.
-- The paid alpha does not support split-tender or multi-transaction receipt
-- allocation: one receipt may be attached to at most one bank transaction,
-- either as a matched relationship or a pending-review link. Before adding
-- uniqueness protection, any pre-existing duplicate relationship is resolved
-- deterministically (the earliest transaction is kept) and every displaced
-- transaction is reopened to professional review with an audit trail
-- explaining why, so no accounting history is silently discarded. Replay-safe.

DO $$
DECLARE
  dup RECORD;
  keeper_id TEXT;
  loser_bt RECORD;
BEGIN
  FOR dup IN
    SELECT client_id, matched_receipt_id
    FROM bank_transactions
    WHERE matched_receipt_id IS NOT NULL
    GROUP BY client_id, matched_receipt_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keeper_id
    FROM bank_transactions
    WHERE client_id = dup.client_id AND matched_receipt_id = dup.matched_receipt_id
    ORDER BY resolved_at ASC NULLS LAST, created_at ASC, id ASC
    LIMIT 1;

    FOR loser_bt IN
      SELECT * FROM bank_transactions
      WHERE client_id = dup.client_id AND matched_receipt_id = dup.matched_receipt_id AND id <> keeper_id
    LOOP
      INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
      VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text || loser_bt.id),
        dup.client_id,
        dup.matched_receipt_id,
        NULL,
        'bank_duplicate_receipt_match_reopened',
        to_jsonb(loser_bt),
        jsonb_build_object(
          'id', loser_bt.id,
          'triage', 'needs_review',
          'matched_receipt_id', NULL,
          'reason', 'Duplicate receipt match detected during migration; kept transaction ' || keeper_id || ' as the canonical match for this receipt.'
        )
      );

      UPDATE bank_transactions
      SET triage = 'needs_review',
          matched_receipt_id = NULL,
          resolution_reason = NULL,
          resolved_at = NULL,
          resolved_by_user_id = NULL
      WHERE id = loser_bt.id;
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE
  dup RECORD;
  keeper_id TEXT;
  loser_bt RECORD;
BEGIN
  FOR dup IN
    SELECT client_id, pending_receipt_id
    FROM bank_transactions
    WHERE pending_receipt_id IS NOT NULL
    GROUP BY client_id, pending_receipt_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keeper_id
    FROM bank_transactions
    WHERE client_id = dup.client_id AND pending_receipt_id = dup.pending_receipt_id
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    FOR loser_bt IN
      SELECT * FROM bank_transactions
      WHERE client_id = dup.client_id AND pending_receipt_id = dup.pending_receipt_id AND id <> keeper_id
    LOOP
      INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
      VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text || loser_bt.id),
        dup.client_id,
        dup.pending_receipt_id,
        NULL,
        'bank_duplicate_receipt_match_reopened',
        to_jsonb(loser_bt),
        jsonb_build_object(
          'id', loser_bt.id,
          'triage', 'needs_review',
          'pending_receipt_id', NULL,
          'reason', 'Duplicate pending receipt link detected during migration; kept transaction ' || keeper_id || ' as the canonical link for this receipt.'
        )
      );

      UPDATE bank_transactions
      SET triage = 'needs_review',
          pending_receipt_id = NULL,
          resolution_reason = NULL
      WHERE id = loser_bt.id;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_unique_matched_receipt
  ON bank_transactions (client_id, matched_receipt_id) WHERE matched_receipt_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_unique_pending_receipt
  ON bank_transactions (client_id, pending_receipt_id) WHERE pending_receipt_id IS NOT NULL;
