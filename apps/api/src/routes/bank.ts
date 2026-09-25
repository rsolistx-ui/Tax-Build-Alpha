import { Hono } from "hono";
import { z } from "zod";
import { createDb, type DbStatement } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { newId } from "../lib/id";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import {
  cardSignCheck,
  normalizeBankCsv,
  previewBankCsv,
  type BankColumnMapping,
  type NormalizedBankRow,
} from "../services/bank-csv";
import {
  suggestReceiptMatch,
  type ReceiptMatchCandidate,
} from "../services/bank-reconciliation";
import { delegateBankImportAgent } from "../services/agent-supervisor";

export const bankRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const mappingSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.string().min(1).nullable().optional(),
  debit: z.string().min(1).nullable().optional(),
  credit: z.string().min(1).nullable().optional(),
  currency: z.string().min(1).nullable().optional(),
});

const DISPOSITIONS = [
  "business_expense",
  "business_income",
  "personal",
  "transfer",
  "owner_contribution",
  "owner_draw",
  "loan",
  "other_excluded",
  "unclassified",
] as const;

const dispositionSchema = z.object({
  disposition: z.enum(DISPOSITIONS),
  categoryId: z.string().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

const decisionSchema = z.object({
  action: z.enum(["confirm", "reject", "link_receipt", "no_receipt_required"]),
  receiptId: z.string().min(1).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

bankRoutes.get("/:clientId/bank-transactions", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const triage = c.req.query("triage") || null;
  const rows = await db.query<Record<string, unknown>>(
    `SELECT
       bt.*,
       sr.extracted_date AS suggested_receipt_date,
       sr.extracted_merchant AS suggested_receipt_merchant,
       sr.extracted_total AS suggested_receipt_total,
       sr.filename AS suggested_receipt_filename,
       mr.extracted_date AS matched_receipt_date,
       mr.extracted_merchant AS matched_receipt_merchant,
       mr.extracted_total AS matched_receipt_total,
       mr.filename AS matched_receipt_filename,
       pr.status AS pending_receipt_status,
       pr.extracted_date AS pending_receipt_date,
       pr.extracted_merchant AS pending_receipt_merchant,
       pr.extracted_total AS pending_receipt_total,
       pr.filename AS pending_receipt_filename,
       cat.name AS category_name,
       cat.slug AS category_slug
     FROM bank_transactions bt
     LEFT JOIN receipts sr ON sr.id = bt.suggested_receipt_id AND sr.client_id = bt.client_id
     LEFT JOIN receipts mr ON mr.id = bt.matched_receipt_id AND mr.client_id = bt.client_id
     LEFT JOIN receipts pr ON pr.id = bt.pending_receipt_id AND pr.client_id = bt.client_id
     LEFT JOIN categories cat ON cat.id = bt.category_id AND cat.client_id = bt.client_id
     WHERE bt.client_id = $1 AND ($2::text IS NULL OR bt.triage = $2)
     ORDER BY bt.txn_date DESC NULLS LAST, bt.created_at DESC
     LIMIT 500`,
    [client.id, triage],
  );

  const transactions = rows.map((row) => serializeTransaction(row, client.id));
  const counts = transactions.reduce<Record<string, number>>((acc, transaction) => {
    acc[transaction.triage] = (acc[transaction.triage] ?? 0) + 1;
    return acc;
  }, {});
  const summary = {
    total: transactions.length,
    matched: counts.matched ?? 0,
    needsReview: (counts.likely_match ?? 0) + (counts.needs_review ?? 0),
    missingReceipt: counts.unmatched ?? 0,
    receiptPending: counts.receipt_pending ?? 0,
    noReceiptRequired: counts.no_receipt_required ?? 0,
    resolved: (counts.matched ?? 0) + (counts.no_receipt_required ?? 0),
    actionCount:
      (counts.likely_match ?? 0) +
      (counts.needs_review ?? 0) +
      (counts.unmatched ?? 0) +
      (counts.receipt_pending ?? 0),
  };
  return c.json({ transactions, counts, summary });
});

bankRoutes.get("/:clientId/bank-transactions/:transactionId/audit", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const transactionId = c.req.param("transactionId");
  const [transaction] = await db.query<{ id: string }>(
    `SELECT id FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [transactionId, client.id],
  );
  if (!transaction) return c.json({ error: "Not found" }, 404);

  const events = await db.query<Record<string, unknown>>(
    `SELECT id, receipt_id, actor_user_id, action, before_json, after_json, created_at
     FROM audit_events
     WHERE client_id = $1
       AND action IN (
         'bank_match_confirmed',
         'bank_match_rejected',
         'bank_receipt_linked_pending_review',
         'bank_receipt_uploaded',
         'bank_no_receipt_required',
         'bank_disposition_changed',
         'bank_duplicate_receipt_match_reopened'
       )
       AND (before_json->>'id' = $2 OR after_json->>'id' = $2 OR after_json->>'transactionId' = $2)
     ORDER BY created_at ASC`,
    [client.id, transactionId],
  );
  return c.json({ events });
});

bankRoutes.get("/:clientId/bank-transactions/:transactionId/receipt-options", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const transactionId = c.req.param("transactionId");
  const [transaction] = await db.query<{ txn_date: string | null; description: string; amount: number }>(
    `SELECT txn_date, description, amount FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [transactionId, client.id],
  );
  if (!transaction) return c.json({ error: "Not found" }, 404);

  const receipts = await db.query<Record<string, unknown>>(
    `SELECT r.id, r.status, r.extracted_date, r.extracted_merchant, r.extracted_total, r.filename, r.created_at
     FROM receipts r
     WHERE r.client_id = $1 AND r.status IN ('review', 'filed')
       AND NOT EXISTS (
         SELECT 1 FROM bank_transactions bt
         WHERE bt.client_id = r.client_id AND bt.id <> $2
           AND (bt.matched_receipt_id = r.id OR bt.pending_receipt_id = r.id)
       )
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [client.id, transactionId],
  );

  const options = receipts
    .map((receipt) => ({ receipt, rank: receiptOptionRank(transaction, receipt) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 25)
    .map(({ receipt }) => ({
      id: String(receipt.id),
      status: String(receipt.status),
      date: receipt.extracted_date ? String(receipt.extracted_date) : null,
      merchant: receipt.extracted_merchant ? String(receipt.extracted_merchant) : null,
      total: receipt.extracted_total === null || receipt.extracted_total === undefined ? null : Number(receipt.extracted_total),
      filename: receipt.filename ? String(receipt.filename) : null,
      sourceUrl: `/api/clients/${client.id}/receipts/${String(receipt.id)}/source`,
    }));

  return c.json({ receipts: options });
});

bankRoutes.post("/:clientId/bank-transactions/preview", async (c) => {
  const { client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const file = await csvFileFromRequest(c);
  const preview = previewBankCsv(await file.text());
  if (preview.rowCount > MAX_IMPORT_ROWS) {
    return c.json({ error: `CSV exceeds the ${MAX_IMPORT_ROWS} row paid-alpha limit` }, 400);
  }
  return c.json({ ...preview, filename: file.name });
});

async function importAccount(db: ReturnType<typeof createDb>, clientId: string, accountId: string) {
  const [account] = await db.query<{ id: string; kind: string; charges_positive: boolean }>(
    `SELECT id, kind, charges_positive FROM client_accounts WHERE id = $1 AND client_id = $2 AND kind IN ('checking', 'savings', 'credit_card')`,
    [accountId, clientId],
  );
  return account ?? null;
}

/**
 * Before importing into a credit card account: applies the account's sign setting to the
 * mapped rows and says whether the result still looks backwards. Saves nothing.
 */
bankRoutes.post("/:clientId/bank-transactions/sign-check", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const form = await c.req.formData();
  const entry = form.get("file");
  const accountId = form.get("accountId");
  const mappingValue = form.get("mapping");
  if (!entry || typeof entry === "string" || typeof accountId !== "string" || typeof mappingValue !== "string") {
    return c.json({ error: "file, mapping and accountId are required" }, 400);
  }
  const file = entry as File;
  validateCsvFile(file);
  const account = await importAccount(db, client.id, accountId);
  if (!account) return c.json({ error: "Account not found" }, 404);
  if (account.kind !== "credit_card") return c.json({ applies: false });
  let mapping: BankColumnMapping;
  try {
    mapping = mappingSchema.parse(JSON.parse(mappingValue)) as BankColumnMapping;
  } catch {
    return c.json({ error: "mapping must be valid JSON" }, 400);
  }
  const normalized = normalizeBankCsv(await file.text(), mapping);
  // Debit and credit columns are already signed; the setting applies only to a single amount column, as on import.
  const sign = account.charges_positive && mapping.amount ? -1 : 1;
  const check = cardSignCheck(normalized.rows.map((r) => ({ description: r.description, amount: sign * r.amount })));
  return c.json({
    applies: true,
    chargesPositive: account.charges_positive,
    ...check,
    message: check.looksInverted
      ? account.charges_positive
        ? "This file looks backwards with signs flipped: charges would be saved as money in. Turn off \"Charges show as positive numbers\" for this account, then check again."
        : "This file looks backwards: charges would be saved as money in. If the card issuer exports charges as positive numbers (Amex does), turn on \"Charges show as positive numbers\" for this account, then check again."
      : null,
  });
});

bankRoutes.post("/:clientId/bank-transactions/import", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const form = await c.req.formData();
  const entry = form.get("file");
  if (!entry || typeof entry === "string") return c.json({ error: "file is required" }, 400);
  const file = entry as File;
  validateCsvFile(file);

  const mappingValue = form.get("mapping");
  if (typeof mappingValue !== "string") return c.json({ error: "mapping is required" }, 400);
  let mappingJson: unknown;
  try {
    mappingJson = JSON.parse(mappingValue);
  } catch {
    return c.json({ error: "mapping must be valid JSON" }, 400);
  }
  const mapping = mappingSchema.parse(mappingJson) as BankColumnMapping;

  // Optional: the client account (checking, savings or credit card) this statement belongs to.
  const accountValue = form.get("accountId");
  const accountId = typeof accountValue === "string" && accountValue ? accountValue : null;
  const account = accountId ? await importAccount(db, client.id, accountId) : null;
  if (accountId && !account) return c.json({ error: "Choose a checking, savings, or credit card account for this client." }, 400);

  const text = await file.text();
  const preview = previewBankCsv(text);
  if (preview.rowCount > MAX_IMPORT_ROWS) {
    return c.json({ error: `CSV exceeds the ${MAX_IMPORT_ROWS} row paid-alpha limit` }, 400);
  }

  const [profile] = await db.query<{ default_currency: string | null }>(
    `SELECT default_currency FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  const normalized = normalizeBankCsv(text, mapping, profile?.default_currency || "USD");
  if (normalized.rows.length === 0) {
    return c.json({ error: "CSV did not contain any valid transaction rows", rowErrors: normalized.errors }, 400);
  }
  // The account says its issuer exports charges as positive: store them as money out. raw_json keeps the original.
  // Only a single signed amount column is flipped; debit and credit columns are already signed (signFlipped stays null).
  const signFlipped: boolean | null = mapping.amount ? Boolean(account?.charges_positive) : null;
  if (signFlipped) for (const row of normalized.rows) row.amount = -row.amount;

  const receipts = await db.query<ReceiptMatchCandidate>(
    `SELECT id, extracted_date, extracted_merchant, extracted_total, filename
     FROM receipts r
     WHERE r.client_id = $1
       AND r.status = 'filed'
       AND r.extracted_total IS NOT NULL
       AND r.extracted_date IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM bank_transactions bt
         WHERE bt.client_id = r.client_id AND (bt.matched_receipt_id = r.id OR bt.pending_receipt_id = r.id)
       )
     ORDER BY r.extracted_date DESC
     LIMIT 5000`,
    [client.id],
  );
  const receiptIndex = indexReceiptsByAmount(receipts);
  const importBatchId = newId("imp");
  const occurrences = new Map<string, number>();
  const prepared = [] as Array<{
    row: NormalizedBankRow;
    id: string;
    fingerprint: string;
    triage: string;
    suggestion: ReturnType<typeof suggestReceiptMatch>;
  }>;

  for (const row of normalized.rows) {
    // Fingerprint the file's own amount, so re-importing after changing the sign setting is still a duplicate.
    const base = fingerprintBase(signFlipped ? { ...row, amount: -row.amount } : row);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const fingerprint = await sha256Hex(`${client.id}|${base}|${occurrence}`);
    const candidates = candidateReceipts(receiptIndex, row.amount);
    const suggestion = suggestReceiptMatch(row, candidates);
    prepared.push({
      row,
      id: newId("txn"),
      fingerprint,
      triage: suggestion ? (suggestion.ambiguous ? "needs_review" : "likely_match") : "unmatched",
      suggestion,
    });
  }

  const statements: DbStatement[] = prepared.map((item) => ({
    query: `INSERT INTO bank_transactions
      (id, client_id, txn_date, description, amount, currency, triage, raw_json,
       import_fingerprint, suggested_receipt_id, suggested_score, suggested_reason,
       suggested_disposition, account_id, sign_flipped)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT DO NOTHING
      RETURNING id`,
    params: [
      item.id,
      client.id,
      item.row.date,
      item.row.description,
      item.row.amount,
      item.row.currency,
      item.triage,
      {
        importBatchId,
        sourceFilename: file.name,
        sourceRow: item.row.sourceRow,
        original: item.row.raw,
      },
      item.fingerprint,
      item.suggestion?.receiptId ?? null,
      item.suggestion?.score ?? null,
      item.suggestion?.reason ?? null,
      suggestDisposition(item.row.amount),
      accountId,
      signFlipped,
    ],
  }));

  const results = await db.transaction<{ id: string }>(statements);
  const insertedCount = results.reduce((count, result) => count + (result.length > 0 ? 1 : 0), 0);
  const duplicateCount = prepared.length - insertedCount;

  await db.query(
    `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
     VALUES ($1, $2, $3, 'bank_csv_imported', $4::jsonb)`,
    [
      newId("aud"),
      client.id,
      c.get("userId"),
      {
        importBatchId,
        filename: file.name,
        parsedRows: preview.rowCount,
        validRows: prepared.length,
        insertedCount,
        duplicateCount,
        rejectedRowCount: normalized.errors.length,
        rowErrors: normalized.errors.slice(0, 100),
      },
    ],
  );
  try {
    await delegateBankImportAgent(db, {
      firmId: client.firm_id,
      clientId: client.id,
      importBatchId,
      insertedCount,
      duplicateCount,
    });
  } catch (error) {
    // The import and its audit event are committed; return their durable
    // result and retain an actionable Worker log for the optional hand-off.
    console.error(`agent supervisor delegation failed for bank import ${importBatchId}:`, error);
  }

  return c.json({
    importBatchId,
    parsedRows: preview.rowCount,
    validRows: prepared.length,
    insertedCount,
    duplicateCount,
    rejectedRowCount: normalized.errors.length,
    rowErrors: normalized.errors,
  }, 201);
});

bankRoutes.post("/:clientId/bank-transactions/:transactionId/decision", async (c) => {
  const body = decisionSchema.parse(await c.req.json());
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const transactionId = c.req.param("transactionId");
  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [transactionId, client.id],
  );
  if (!before) return c.json({ error: "Not found" }, 404);

  if (body.action === "confirm") {
    const receiptId = body.receiptId || String(before.suggested_receipt_id || "");
    if (!receiptId) return c.json({ error: "A receipt match is required to confirm" }, 400);
    const [receipt] = await db.query<{ id: string }>(
      `SELECT id FROM receipts WHERE id = $1 AND client_id = $2 AND status = 'filed'`,
      [receiptId, client.id],
    );
    if (!receipt) return c.json({ error: "Filed receipt evidence was not found" }, 404);

    const [conflict] = await db.query<{ id: string }>(
      `SELECT id FROM bank_transactions
       WHERE client_id = $1 AND id <> $2 AND (matched_receipt_id = $3 OR pending_receipt_id = $3)`,
      [client.id, transactionId, receiptId],
    );
    if (conflict) {
      return c.json({ error: receiptAlreadyAttachedMessage(conflict.id) }, 409);
    }

    let after: Record<string, unknown> | undefined;
    try {
      [after] = await db.query<Record<string, unknown>>(
        `UPDATE bank_transactions SET
           triage = 'matched', matched_receipt_id = $1, pending_receipt_id = NULL,
           resolution_reason = NULL, resolved_at = NOW(), resolved_by_user_id = $2,
           reviewed_at = NOW(), reviewed_by_user_id = $2
         WHERE id = $3 AND client_id = $4
         RETURNING *`,
        [receiptId, c.get("userId"), transactionId, client.id],
      );
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
        return c.json({ error: receiptAlreadyAttachedMessage() }, 409);
      }
      throw error;
    }
    await logBankAudit(db, client.id, receiptId, c.get("userId"), "bank_match_confirmed", before, after);
    return c.json({ transaction: after });
  }

  if (body.action === "link_receipt") {
    if (!body.receiptId) return c.json({ error: "receiptId is required" }, 400);
    const [receipt] = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM receipts WHERE id = $1 AND client_id = $2`,
      [body.receiptId, client.id],
    );
    if (!receipt) return c.json({ error: "Receipt evidence was not found" }, 404);

    const [linkConflict] = await db.query<{ id: string }>(
      `SELECT id FROM bank_transactions
       WHERE client_id = $1 AND id <> $2 AND (matched_receipt_id = $3 OR pending_receipt_id = $3)`,
      [client.id, transactionId, receipt.id],
    );
    if (linkConflict) {
      return c.json({ error: receiptAlreadyAttachedMessage(linkConflict.id) }, 409);
    }

    if (receipt.status === "filed") {
      let after: Record<string, unknown> | undefined;
      try {
        [after] = await db.query<Record<string, unknown>>(
          `UPDATE bank_transactions SET
             triage = 'matched', matched_receipt_id = $1,
             suggested_receipt_id = NULL, suggested_score = NULL, suggested_reason = NULL,
             pending_receipt_id = NULL, resolution_reason = NULL,
             resolved_at = NOW(), resolved_by_user_id = $2,
             reviewed_at = NOW(), reviewed_by_user_id = $2
           WHERE id = $3 AND client_id = $4
           RETURNING *`,
          [receipt.id, c.get("userId"), transactionId, client.id],
        );
      } catch (error) {
        if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
          return c.json({ error: receiptAlreadyAttachedMessage() }, 409);
        }
        throw error;
      }
      await logBankAudit(
        db,
        client.id,
        receipt.id,
        c.get("userId"),
        "bank_match_confirmed",
        before,
        { ...after, resolutionSource: "manual_link" },
      );
      return c.json({ transaction: after });
    }

    if (receipt.status === "review") {
      let after: Record<string, unknown> | undefined;
      try {
        [after] = await db.query<Record<string, unknown>>(
          `UPDATE bank_transactions SET
             triage = 'receipt_pending', pending_receipt_id = $1,
             suggested_receipt_id = NULL, suggested_score = NULL, suggested_reason = NULL,
             matched_receipt_id = NULL, resolution_reason = NULL,
             resolved_at = NULL, resolved_by_user_id = NULL,
             reviewed_at = NOW(), reviewed_by_user_id = $2
           WHERE id = $3 AND client_id = $4
           RETURNING *`,
          [receipt.id, c.get("userId"), transactionId, client.id],
        );
      } catch (error) {
        if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
          return c.json({ error: receiptAlreadyAttachedMessage() }, 409);
        }
        throw error;
      }
      await logBankAudit(
        db,
        client.id,
        receipt.id,
        c.get("userId"),
        "bank_receipt_linked_pending_review",
        before,
        after,
      );
      return c.json({ transaction: after });
    }

    return c.json({ error: "Only receipts in review or filed status can resolve a bank exception" }, 409);
  }

  if (body.action === "no_receipt_required") {
    if (!body.reason) return c.json({ error: "A reason is required" }, 400);
    const priorReceiptId = before.matched_receipt_id || before.pending_receipt_id || before.suggested_receipt_id || null;
    const [after] = await db.query<Record<string, unknown>>(
      `UPDATE bank_transactions SET
         triage = 'no_receipt_required', suggested_receipt_id = NULL, suggested_score = NULL,
         suggested_reason = NULL, matched_receipt_id = NULL, pending_receipt_id = NULL,
         resolution_reason = $1, resolved_at = NOW(), resolved_by_user_id = $2,
         reviewed_at = NOW(), reviewed_by_user_id = $2
       WHERE id = $3 AND client_id = $4
       RETURNING *`,
      [body.reason, c.get("userId"), transactionId, client.id],
    );
    await logBankAudit(
      db,
      client.id,
      priorReceiptId ? String(priorReceiptId) : null,
      c.get("userId"),
      "bank_no_receipt_required",
      before,
      after,
    );
    return c.json({ transaction: after });
  }

  const rejectedReceiptId = before.matched_receipt_id || before.pending_receipt_id || before.suggested_receipt_id || null;
  const [after] = await db.query<Record<string, unknown>>(
    `UPDATE bank_transactions SET
       triage = 'unmatched', suggested_receipt_id = NULL, suggested_score = NULL,
       suggested_reason = NULL, matched_receipt_id = NULL, pending_receipt_id = NULL,
       resolution_reason = NULL, resolved_at = NULL, resolved_by_user_id = NULL,
       reviewed_at = NOW(), reviewed_by_user_id = $1
     WHERE id = $2 AND client_id = $3
     RETURNING *`,
    [c.get("userId"), transactionId, client.id],
  );
  await logBankAudit(
    db,
    client.id,
    rejectedReceiptId ? String(rejectedReceiptId) : null,
    c.get("userId"),
    "bank_match_rejected",
    before,
    after,
  );
  return c.json({ transaction: after });
});

bankRoutes.patch("/:clientId/bank-transactions/:transactionId/disposition", async (c) => {
  const body = dispositionSchema.parse(await c.req.json());
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const transactionId = c.req.param("transactionId");
  const userId = c.get("userId");

  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [transactionId, client.id],
  );
  if (!before) return c.json({ error: "Not found" }, 404);

  let categoryId: string | null = null;
  if (body.categoryId) {
    const [category] = await db.query<{ id: string }>(
      `SELECT id FROM categories WHERE id = $1 AND client_id = $2`,
      [body.categoryId, client.id],
    );
    if (!category) return c.json({ error: "Category not found" }, 404);
    categoryId = category.id;
  }

  const [after] = await db.query<Record<string, unknown>>(
    `UPDATE bank_transactions SET
       disposition = $1,
       category_id = $2,
       disposition_note = $3,
       disposition_reviewed_at = NOW(),
       disposition_reviewed_by_user_id = $4
     WHERE id = $5 AND client_id = $6
     RETURNING *`,
    [body.disposition, categoryId, body.note ?? null, userId, transactionId, client.id],
  );

  await db.query(
    `INSERT INTO audit_events (id, client_id, actor_user_id, action, before_json, after_json)
     VALUES ($1, $2, $3, 'bank_disposition_changed', $4::jsonb, $5::jsonb)`,
    [newId("aud"), client.id, userId, before, after],
  );

  return c.json({ transaction: serializeTransaction(after, client.id) });
});

bankRoutes.post("/:clientId/bank-transactions/batch-auto-triage", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const userId = c.get("userId");

  const eligible = await db.query<{
    id: string;
    suggested_receipt_id: string | null;
    suggested_disposition: string | null;
    suggested_score: number | null;
  }>(
    `SELECT id, suggested_receipt_id, suggested_disposition, suggested_score
     FROM bank_transactions
     WHERE client_id = $1
       AND triage IN ('likely_match', 'needs_review', 'unmatched')
       AND (suggested_receipt_id IS NOT NULL OR suggested_disposition IS NOT NULL)
     LIMIT 250`,
    [client.id],
  );

  let approvedMatches = 0;
  let classifiedDispositions = 0;

  for (const item of eligible) {
    if (item.suggested_receipt_id && (item.suggested_score ?? 0) >= 80) {
      const [conflict] = await db.query<{ id: string }>(
        `SELECT id FROM bank_transactions WHERE client_id = $1 AND id <> $2 AND matched_receipt_id = $3`,
        [client.id, item.id, item.suggested_receipt_id],
      );
      if (!conflict) {
        await db.query(
          `UPDATE bank_transactions SET
             triage = 'matched',
             matched_receipt_id = $1,
             resolved_at = NOW(),
             resolved_by_user_id = $2,
             reviewed_at = NOW(),
             reviewed_by_user_id = $2,
             disposition = COALESCE(disposition, suggested_disposition, 'business_expense')
           WHERE id = $3 AND client_id = $4`,
          [item.suggested_receipt_id, userId, item.id, client.id],
        );
        approvedMatches++;
        continue;
      }
    }

    if (item.suggested_disposition) {
      await db.query(
        `UPDATE bank_transactions SET
           disposition = COALESCE(disposition, $1),
           disposition_reviewed_at = NOW(),
           reviewed_at = NOW(),
           reviewed_by_user_id = $2
         WHERE id = $3 AND client_id = $4 AND (disposition IS NULL OR disposition = 'unclassified')`,
        [item.suggested_disposition, userId, item.id, client.id],
      );
      classifiedDispositions++;
    }
  }

  if (approvedMatches > 0 || classifiedDispositions > 0) {
    await db.query(
      `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
       VALUES ($1, $2, $3, 'bank_batch_auto_triage', $4::jsonb)`,
      [
        newId("aud"),
        client.id,
        userId,
        { approvedMatches, classifiedDispositions, totalProcessed: eligible.length },
      ],
    );
  }

  return c.json({
    approvedMatches,
    classifiedDispositions,
    totalProcessed: eligible.length,
    message: `Batch auto-triage complete: approved ${approvedMatches} matches and classified ${classifiedDispositions} transactions.`,
  });
});

async function authorizedClient(c: {
  env: Env;
  get(key: "userId" | "userName"): string;
  req: { param(name: string): string };
}) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  return { db, firm, client };
}

async function csvFileFromRequest(c: { req: { formData(): Promise<FormData> } }): Promise<File> {
  const form = await c.req.formData();
  const entry = form.get("file");
  if (!entry || typeof entry === "string") throw new Error("file is required");
  const file = entry as File;
  validateCsvFile(file);
  return file;
}

function validateCsvFile(file: File): void {
  if (file.size <= 0) throw new Error("CSV file is empty");
  if (file.size > MAX_CSV_BYTES) throw new Error("CSV exceeds the 5 MB paid-alpha limit");
  if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Bank import requires a .csv file");
}

function indexReceiptsByAmount(receipts: ReceiptMatchCandidate[]): Map<number, ReceiptMatchCandidate[]> {
  const index = new Map<number, ReceiptMatchCandidate[]>();
  for (const receipt of receipts) {
    if (receipt.extracted_total === null || receipt.extracted_total === undefined) continue;
    const cents = Math.round(Math.abs(Number(receipt.extracted_total)) * 100);
    const list = index.get(cents) ?? [];
    list.push(receipt);
    index.set(cents, list);
  }
  return index;
}

function candidateReceipts(index: Map<number, ReceiptMatchCandidate[]>, amount: number): ReceiptMatchCandidate[] {
  const cents = Math.round(Math.abs(amount) * 100);
  return [-2, -1, 0, 1, 2].flatMap((offset) => index.get(cents + offset) ?? []);
}

function fingerprintBase(row: NormalizedBankRow): string {
  const description = row.description.toLowerCase().replace(/\s+/g, " ").trim();
  return `${row.date}|${description}|${row.amount.toFixed(2)}|${row.currency}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function receiptOptionRank(
  transaction: { txn_date: string | null; description: string; amount: number },
  receipt: Record<string, unknown>,
): number {
  const transactionAmount = Math.abs(Number(transaction.amount ?? 0));
  const receiptAmount = receipt.extracted_total === null || receipt.extracted_total === undefined
    ? null
    : Math.abs(Number(receipt.extracted_total));
  const amountPenalty = receiptAmount === null ? 100000 : Math.abs(transactionAmount - receiptAmount) * 100;

  let datePenalty = 365;
  if (transaction.txn_date && receipt.extracted_date) {
    const left = new Date(`${String(transaction.txn_date).slice(0, 10)}T00:00:00Z`).getTime();
    const right = new Date(`${String(receipt.extracted_date).slice(0, 10)}T00:00:00Z`).getTime();
    if (Number.isFinite(left) && Number.isFinite(right)) {
      datePenalty = Math.abs(left - right) / 86400000;
    }
  }

  const bankTokens = tokenSet(transaction.description);
  const receiptTokens = tokenSet(String(receipt.extracted_merchant ?? ""));
  const shared = [...bankTokens].filter((token) => receiptTokens.has(token)).length;
  const merchantBonus = shared * 4;
  const statusPenalty = receipt.status === "filed" ? 0 : 0.25;
  return amountPenalty + Math.min(datePenalty, 365) - merchantBonus + statusPenalty;
}

/**
 * Deterministic, transparent starting point only: a positive amount is a
 * deposit (income-shaped), a negative amount is a debit (expense-shaped).
 * This never writes to the real `disposition` column, only the separate
 * `suggested_disposition` field the professional can accept or override -
 * the actual disposition always starts unclassified.
 */
function receiptAlreadyAttachedMessage(otherTransactionId?: string): string {
  return `This receipt is already attached to another bank transaction${otherTransactionId ? ` (${otherTransactionId})` : ""}. The paid alpha allows one receipt per bank transaction.`;
}

function suggestDisposition(amount: number): "business_income" | "business_expense" {
  return amount > 0 ? "business_income" : "business_expense";
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

async function logBankAudit(
  db: ReturnType<typeof createDb>,
  clientId: string,
  receiptId: string | null,
  userId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  await db.query(
    `INSERT INTO audit_events
      (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [newId("aud"), clientId, receiptId, userId, action, before, after],
  );
}

function serializeTransaction(row: Record<string, unknown>, clientId: string) {
  const suggestedReceiptId = typeof row.suggested_receipt_id === "string" ? row.suggested_receipt_id : null;
  const matchedReceiptId = typeof row.matched_receipt_id === "string" ? row.matched_receipt_id : null;
  const pendingReceiptId = typeof row.pending_receipt_id === "string" ? row.pending_receipt_id : null;
  return {
    id: String(row.id),
    date: row.txn_date ? String(row.txn_date) : null,
    description: row.description ? String(row.description) : "",
    amount: Number(row.amount ?? 0),
    currency: String(row.currency ?? "USD"),
    triage: String(row.triage ?? "unmatched"),
    suggestedScore: row.suggested_score === null || row.suggested_score === undefined ? null : Number(row.suggested_score),
    suggestedReason: row.suggested_reason ? String(row.suggested_reason) : null,
    resolutionReason: row.resolution_reason ? String(row.resolution_reason) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    suggestedReceipt: suggestedReceiptId ? {
      id: suggestedReceiptId,
      status: "filed",
      date: row.suggested_receipt_date ? String(row.suggested_receipt_date) : null,
      merchant: row.suggested_receipt_merchant ? String(row.suggested_receipt_merchant) : null,
      total: row.suggested_receipt_total === null || row.suggested_receipt_total === undefined ? null : Number(row.suggested_receipt_total),
      filename: row.suggested_receipt_filename ? String(row.suggested_receipt_filename) : null,
      sourceUrl: `/api/clients/${clientId}/receipts/${suggestedReceiptId}/source`,
    } : null,
    matchedReceipt: matchedReceiptId ? {
      id: matchedReceiptId,
      status: "filed",
      date: row.matched_receipt_date ? String(row.matched_receipt_date) : null,
      merchant: row.matched_receipt_merchant ? String(row.matched_receipt_merchant) : null,
      total: row.matched_receipt_total === null || row.matched_receipt_total === undefined ? null : Number(row.matched_receipt_total),
      filename: row.matched_receipt_filename ? String(row.matched_receipt_filename) : null,
      sourceUrl: `/api/clients/${clientId}/receipts/${matchedReceiptId}/source`,
    } : null,
    pendingReceipt: pendingReceiptId ? {
      id: pendingReceiptId,
      status: row.pending_receipt_status ? String(row.pending_receipt_status) : "review",
      date: row.pending_receipt_date ? String(row.pending_receipt_date) : null,
      merchant: row.pending_receipt_merchant ? String(row.pending_receipt_merchant) : null,
      total: row.pending_receipt_total === null || row.pending_receipt_total === undefined ? null : Number(row.pending_receipt_total),
      filename: row.pending_receipt_filename ? String(row.pending_receipt_filename) : null,
      sourceUrl: `/api/clients/${clientId}/receipts/${pendingReceiptId}/source`,
    } : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    disposition: String(row.disposition ?? "unclassified"),
    suggestedDisposition: row.suggested_disposition ? String(row.suggested_disposition) : null,
    dispositionNote: row.disposition_note ? String(row.disposition_note) : null,
    dispositionReviewedAt: row.disposition_reviewed_at ? String(row.disposition_reviewed_at) : null,
    category: row.category_id ? {
      id: String(row.category_id),
      name: row.category_name ? String(row.category_name) : null,
      slug: row.category_slug ? String(row.category_slug) : null,
    } : null,
  };
}
