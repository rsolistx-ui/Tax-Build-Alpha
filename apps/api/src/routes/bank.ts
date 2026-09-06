import { Hono } from "hono";
import { z } from "zod";
import { createDb, type DbStatement } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { newId } from "../lib/id";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import {
  normalizeBankCsv,
  previewBankCsv,
  type BankColumnMapping,
  type NormalizedBankRow,
} from "../services/bank-csv";
import { planClassifyBankTransaction, planAttachBankSourceToReceiptLedgerEntry } from "../services/ledger";
import {
  suggestReceiptMatch,
  type ReceiptMatchCandidate,
} from "../services/bank-reconciliation";

export const bankRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
bankRoutes.use("*", requireSession);

const mappingSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.string().min(1).nullable().optional(),
  debit: z.string().min(1).nullable().optional(),
  credit: z.string().min(1).nullable().optional(),
  currency: z.string().min(1).nullable().optional(),
});

const decisionSchema = z.object({
  action: z.enum(["confirm", "reject", "link_receipt", "no_receipt_required"]),
  receiptId: z.string().min(1).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

const classifySchema = z.object({
  accountingClass: z.enum(["expense", "income", "transfer", "owner_contribution", "owner_draw", "needs_review"]),
  treatment: z.enum(["business", "personal"]),
  categoryId: z.string().nullable().optional(),
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
       pr.filename AS pending_receipt_filename
     FROM bank_transactions bt
     LEFT JOIN receipts sr ON sr.id = bt.suggested_receipt_id AND sr.client_id = bt.client_id
     LEFT JOIN receipts mr ON mr.id = bt.matched_receipt_id AND mr.client_id = bt.client_id
     LEFT JOIN receipts pr ON pr.id = bt.pending_receipt_id AND pr.client_id = bt.client_id
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

bankRoutes.get("/:clientId/bank-transactions/:transactionId", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const transactionId = c.req.param("transactionId");

  const [txn] = await db.query<Record<string, unknown>>(
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
       pr.filename AS pending_receipt_filename
     FROM bank_transactions bt
     LEFT JOIN receipts sr ON sr.id = bt.suggested_receipt_id AND sr.client_id = bt.client_id
     LEFT JOIN receipts mr ON mr.id = bt.matched_receipt_id AND mr.client_id = bt.client_id
     LEFT JOIN receipts pr ON pr.id = bt.pending_receipt_id AND pr.client_id = bt.client_id
     WHERE bt.client_id = $1 AND bt.id = $2`,
    [client.id, transactionId],
  );

  if (!txn) return c.json({ error: "Not found" }, 404);

  return c.json({ transaction: serializeTransaction(txn, client.id) });
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
         'bank_no_receipt_required'
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
    `SELECT id, status, extracted_date, extracted_merchant, extracted_total, filename, created_at
     FROM receipts
     WHERE client_id = $1 AND status IN ('review', 'filed')
     ORDER BY created_at DESC
     LIMIT 200`,
    [client.id],
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

  // Closed-period guard: reject import if any row falls in a closed period
  const periodKeys = new Set<string>();
  for (const row of normalized.rows) {
    if (row.date) {
      periodKeys.add(row.date.slice(0, 7));
    }
  }
  for (const periodKey of periodKeys) {
    try {
      await checkPeriodOpen(db, client.id, periodKey);
    } catch {
      return c.json({ error: `Cannot import: period ${periodKey} is closed` }, 409);
    }
  }

  const receipts = await db.query<ReceiptMatchCandidate>(
    `SELECT id, extracted_date, extracted_merchant, extracted_total, filename
     FROM receipts
     WHERE client_id = $1
       AND status = 'filed'
       AND extracted_total IS NOT NULL
       AND extracted_date IS NOT NULL
     ORDER BY extracted_date DESC
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
    const base = fingerprintBase(row);
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
       import_fingerprint, suggested_receipt_id, suggested_score, suggested_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
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
  const userId = c.get("userId");
  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [transactionId, client.id],
  );
  if (!before) return c.json({ error: "Not found" }, 404);

  // Closed-period guard: all bank decisions are accounting mutations
  if (before.txn_date) {
    const periodKey = String(before.txn_date).slice(0, 7);
    try {
      await checkPeriodOpen(db, client.id, periodKey);
    } catch {
      return c.json({ error: "Cannot mutate accounting in a closed period" }, 409);
    }
  }

  if (body.action === "confirm") {
    const receiptId = body.receiptId || String(before.suggested_receipt_id || "");
    if (!receiptId) return c.json({ error: "A receipt match is required to confirm" }, 400);
    const [receipt] = await db.query<{ id: string }>(
      `SELECT id FROM receipts WHERE id = $1 AND client_id = $2 AND status = 'filed'`,
      [receiptId, client.id],
    );
    if (!receipt) return c.json({ error: "Filed receipt evidence was not found" }, 404);

    const afterSnapshot = {
      ...before,
      triage: "matched",
      matched_receipt_id: receiptId,
      pending_receipt_id: null,
      resolution_reason: null,
      resolved_by_user_id: userId,
      reviewed_by_user_id: userId,
    };

    // Transactional: bank decision + ledger merge + audit
    const statements: DbStatement[] = [
      {
        query: `UPDATE bank_transactions SET
           triage = 'matched', matched_receipt_id = $1, pending_receipt_id = NULL,
           resolution_reason = NULL, resolved_at = NOW(), resolved_by_user_id = $2,
           reviewed_at = NOW(), reviewed_by_user_id = $2
         WHERE id = $3 AND client_id = $4
         RETURNING *`,
        params: [receiptId, userId, transactionId, client.id],
      },
    ];

    const ledgerStatement = await planAttachBankSourceToReceiptLedgerEntry(db, client.id, receiptId, transactionId);
    if (ledgerStatement) statements.push(ledgerStatement);

    statements.push({
      query: `INSERT INTO audit_events
        (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
        VALUES ($1, $2, $3, $4, 'bank_match_confirmed', $5::jsonb, $6::jsonb)`,
      params: [newId("aud"), client.id, receiptId, userId, before, afterSnapshot],
    });

    const [bankResults] = await db.transaction(statements);
    return c.json({ transaction: bankResults[0] });
  }

  if (body.action === "link_receipt") {
    if (!body.receiptId) return c.json({ error: "receiptId is required" }, 400);
    const [receipt] = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM receipts WHERE id = $1 AND client_id = $2`,
      [body.receiptId, client.id],
    );
    if (!receipt) return c.json({ error: "Receipt evidence was not found" }, 404);

    if (receipt.status === "filed") {
      const afterSnapshot = {
        ...before,
        triage: "matched",
        matched_receipt_id: receipt.id,
        suggested_receipt_id: null,
        pending_receipt_id: null,
        resolution_reason: null,
        resolved_by_user_id: userId,
        reviewed_by_user_id: userId,
        resolutionSource: "manual_link",
      };

      // Transactional: bank decision + ledger merge + audit
      const statements: DbStatement[] = [
        {
          query: `UPDATE bank_transactions SET
             triage = 'matched', matched_receipt_id = $1,
             suggested_receipt_id = NULL, suggested_score = NULL, suggested_reason = NULL,
             pending_receipt_id = NULL, resolution_reason = NULL,
             resolved_at = NOW(), resolved_by_user_id = $2,
             reviewed_at = NOW(), reviewed_by_user_id = $2
           WHERE id = $3 AND client_id = $4
           RETURNING *`,
          params: [receipt.id, userId, transactionId, client.id],
        },
      ];

      const ledgerStatement = await planAttachBankSourceToReceiptLedgerEntry(db, client.id, receipt.id, transactionId);
      if (ledgerStatement) statements.push(ledgerStatement);

      statements.push({
        query: `INSERT INTO audit_events
          (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
          VALUES ($1, $2, $3, $4, 'bank_match_confirmed', $5::jsonb, $6::jsonb)`,
        params: [newId("aud"), client.id, receipt.id, userId, before, afterSnapshot],
      });

      const [bankResults] = await db.transaction(statements);
      return c.json({ transaction: bankResults[0] });
    }

    if (receipt.status === "review") {
      const afterSnapshot = {
        ...before,
        triage: "receipt_pending",
        pending_receipt_id: receipt.id,
        suggested_receipt_id: null,
        matched_receipt_id: null,
        resolution_reason: null,
        reviewed_by_user_id: userId,
      };

      const statements: DbStatement[] = [
        {
          query: `UPDATE bank_transactions SET
             triage = 'receipt_pending', pending_receipt_id = $1,
             suggested_receipt_id = NULL, suggested_score = NULL, suggested_reason = NULL,
             matched_receipt_id = NULL, resolution_reason = NULL,
             resolved_at = NULL, resolved_by_user_id = NULL,
             reviewed_at = NOW(), reviewed_by_user_id = $2
           WHERE id = $3 AND client_id = $4
           RETURNING *`,
          params: [receipt.id, userId, transactionId, client.id],
        },
        {
          query: `INSERT INTO audit_events
            (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
            VALUES ($1, $2, $3, $4, 'bank_receipt_linked_pending_review', $5::jsonb, $6::jsonb)`,
          params: [newId("aud"), client.id, receipt.id, userId, before, afterSnapshot],
        },
      ];

      const [bankResults] = await db.transaction(statements);
      return c.json({ transaction: bankResults[0] });
    }

    return c.json({ error: "Only receipts in review or filed status can resolve a bank exception" }, 409);
  }

  if (body.action === "no_receipt_required") {
    if (!body.reason) return c.json({ error: "A reason is required" }, 400);
    const priorReceiptId = before.matched_receipt_id || before.pending_receipt_id || before.suggested_receipt_id || null;
    const afterSnapshot = {
      ...before,
      triage: "no_receipt_required",
      suggested_receipt_id: null,
      matched_receipt_id: null,
      pending_receipt_id: null,
      resolution_reason: body.reason,
      resolved_by_user_id: userId,
      reviewed_by_user_id: userId,
    };

    // Transactional: bank decision + audit
    const statements: DbStatement[] = [
      {
        query: `UPDATE bank_transactions SET
           triage = 'no_receipt_required', suggested_receipt_id = NULL, suggested_score = NULL,
           suggested_reason = NULL, matched_receipt_id = NULL, pending_receipt_id = NULL,
           resolution_reason = $1, resolved_at = NOW(), resolved_by_user_id = $2,
           reviewed_at = NOW(), reviewed_by_user_id = $2
         WHERE id = $3 AND client_id = $4
         RETURNING *`,
        params: [body.reason, userId, transactionId, client.id],
      },
      {
        query: `INSERT INTO audit_events
          (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
          VALUES ($1, $2, $3, $4, 'bank_no_receipt_required', $5::jsonb, $6::jsonb)`,
        params: [newId("aud"), client.id, priorReceiptId, userId, before, afterSnapshot],
      },
    ];

    const [bankResults] = await db.transaction(statements);
    return c.json({ transaction: bankResults[0] });
  }

  // Reject action
  const rejectedReceiptId = before.matched_receipt_id || before.pending_receipt_id || before.suggested_receipt_id || null;
  const rejectAfterSnapshot = {
    ...before,
    triage: "unmatched",
    suggested_receipt_id: null,
    matched_receipt_id: null,
    pending_receipt_id: null,
    resolution_reason: null,
    resolved_at: null,
    resolved_by_user_id: null,
    reviewed_by_user_id: userId,
  };

  // Transactional: bank decision + audit
  const rejectStatements: DbStatement[] = [
    {
      query: `UPDATE bank_transactions SET
         triage = 'unmatched', suggested_receipt_id = NULL, suggested_score = NULL,
         suggested_reason = NULL, matched_receipt_id = NULL, pending_receipt_id = NULL,
         resolution_reason = NULL, resolved_at = NULL, resolved_by_user_id = NULL,
         reviewed_at = NOW(), reviewed_by_user_id = $1
       WHERE id = $2 AND client_id = $3
       RETURNING *`,
      params: [userId, transactionId, client.id],
    },
    {
      query: `INSERT INTO audit_events
        (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
        VALUES ($1, $2, $3, $4, 'bank_match_rejected', $5::jsonb, $6::jsonb)`,
      params: [newId("aud"), client.id, rejectedReceiptId, userId, before, rejectAfterSnapshot],
    },
  ];

  const [rejectResults] = await db.transaction(rejectStatements);
  return c.json({ transaction: rejectResults[0] });
});

// Classify a resolved bank transaction (explicit professional decision)
bankRoutes.post("/:clientId/bank-transactions/:transactionId/classify", async (c) => {
  const body = classifySchema.parse(await c.req.json());
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const transactionId = c.req.param("transactionId");
  const userId = c.get("userId");

  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [transactionId, client.id],
  );
  if (!before) return c.json({ error: "Not found" }, 404);

  // Reject classification in a closed period
  if (before.txn_date) {
    const periodKey = String(before.txn_date).slice(0, 7);
    const [period] = await db.query<{ state: string }>(
      `SELECT state FROM accounting_periods WHERE client_id = $1 AND period_key = $2`,
      [client.id, periodKey],
    );
    if (period?.state === "closed") {
      return c.json({ error: "Cannot mutate accounting in a closed period" }, 409);
    }
  }

  // Verify category if provided
  if (body.categoryId) {
    const [category] = await db.query<{ id: string }>(
      `SELECT id FROM categories WHERE id = $1 AND client_id = $2`,
      [body.categoryId, client.id],
    );
    if (!category) return c.json({ error: "Category not found" }, 404);
  }

  // Transactionally: bank classification + ledger sync + audit, all in one batch
  const statements: DbStatement[] = [
    {
      query: `UPDATE bank_transactions SET
         accounting_class = $1,
         treatment = $2,
         category_id = $3,
         classified_at = NOW(),
         classified_by_user_id = $4
       WHERE id = $5 AND client_id = $6
       RETURNING *`,
      params: [body.accountingClass, body.treatment, body.categoryId ?? null, userId, transactionId, client.id],
    },
  ];

  if (before.txn_date) {
    const ledgerStatements = await planClassifyBankTransaction(
      db,
      client.id,
      transactionId,
      userId,
      body.accountingClass,
      body.treatment,
      body.categoryId ?? null,
    );
    statements.push(...ledgerStatements);
  }

  const afterSnapshot = {
    ...before,
    accounting_class: body.accountingClass,
    treatment: body.treatment,
    category_id: body.categoryId ?? null,
    classified_by_user_id: userId,
  };
  statements.push({
    query: `INSERT INTO audit_events
      (id, client_id, actor_user_id, action, before_json, after_json)
      VALUES ($1, $2, $3, 'bank_transaction_classified', $4::jsonb, $5::jsonb)`,
    params: [newId("aud"), client.id, userId, before, afterSnapshot],
  });

  const [bankResults] = await db.transaction(statements);
  return c.json({ transaction: bankResults[0] });
});

async function checkPeriodOpen(db: ReturnType<typeof createDb>, clientId: string, periodKey: string): Promise<void> {
  const [period] = await db.query<{ state: string }>(
    `SELECT state FROM accounting_periods WHERE client_id = $1 AND period_key = $2`,
    [clientId, periodKey],
  );
  if (period?.state === "closed") {
    throw new Error("Period is closed");
  }
}

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
  };
}
