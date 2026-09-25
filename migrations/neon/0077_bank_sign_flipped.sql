-- Whether a bank transaction's amount was sign-flipped by its account's
-- "charges show as positive" setting (0075). TRUE or FALSE for rows imported from a
-- single signed amount column; NULL when the file had debit and credit columns
-- (already signed) or the row predates this column. Changing an account's setting
-- re-signs only its non-NULL rows, so the setting always governs them. Replay-safe.
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS sign_flipped BOOLEAN;
