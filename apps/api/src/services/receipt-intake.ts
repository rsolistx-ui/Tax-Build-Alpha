import type { Db, DbStatement } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { getLlmProvider, type ReceiptBusinessContext, type ReceiptExtraction } from "../providers/llm";
import { validateReceipt } from "../services/receipt-validation";
import type { ClientRow } from "../services/clients";

export type ReceiptIngestResult =
  | { ok: true; receiptId: string; jobId: string; bankTransactionId: string | null }
  | { ok: false; receiptId: string; jobId: string; error: string; requestId: string };

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The single receipt intake pipeline: R2 storage, extraction, correction
 * memory, validation, optional pending-receipt linkage to a bank
 * transaction. Used by both the staff upload route and the client portal's
 * evidence-upload route so there is exactly one storage and extraction
 * path, not a duplicate one for client-originated uploads. actorUserId is
 * null for a client-originated upload; the receipt itself still requires
 * mandatory professional review before any accounting disposition, so a
 * null actor here never grants a client-originated upload any special
 * trust.
 */
export async function ingestReceiptForClient(
  db: Db,
  env: Env,
  client: ClientRow,
  file: File,
  actorUserId: string | null,
  bankTransactionId: string | null,
): Promise<ReceiptIngestResult> {
  if (bankTransactionId) {
    const [bankTransaction] = await db.query<Record<string, unknown>>(
      `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
      [bankTransactionId, client.id],
    );
    if (!bankTransaction) throw new HttpError(404, "Bank transaction was not found");
    if (bankTransaction.triage === "matched" || bankTransaction.triage === "no_receipt_required") {
      throw new HttpError(409, "This bank transaction is already resolved");
    }
  }

  const receiptId = newId("rcp");
  const jobId = newId("job");
  const key = `${client.firm_id}/${client.id}/${receiptId}/${file.name}`;
  const bytes = await file.arrayBuffer();

  await env.RECEIPTS.put(key, bytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { filename: file.name, clientId: client.id },
  });

  await db.transaction([
    {
      query: `INSERT INTO receipts
        (id, client_id, r2_key, filename, content_type, size_bytes, status, validation_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', 'pending')`,
      params: [receiptId, client.id, key, file.name, file.type || null, file.size],
    },
    {
      query: `INSERT INTO jobs (id, type, payload, status)
              VALUES ($1, 'receipt_extract', $2::jsonb, 'running')`,
      params: [jobId, { receiptId, clientId: client.id, r2Key: key }],
    },
    {
      query: `UPDATE receipts SET status = 'extracting', updated_at = NOW() WHERE id = $1`,
      params: [receiptId],
    },
  ]);

  try {
    const llm = getLlmProvider(env);
    const context = await loadBusinessContext(db, client);
    let extraction = await llm.extractReceipt({
      bytes,
      contentType: file.type || "application/octet-stream",
      filename: file.name,
      context,
    });
    extraction = await applyCorrectionMemory(db, client.id, extraction);
    const validation = validateReceipt(extraction);

    const statements: DbStatement[] = [
      {
        query: `UPDATE receipts SET
          status = 'review', extracted_date = $1, extracted_merchant = $2,
          extracted_subtotal = $3, extracted_tax = $4, extracted_tip = $5,
          extracted_total = $6, extracted_currency = $7, extracted_category = $8,
          confidence = $9, provider = $10, model = $11,
          validation_status = $12, validation_json = $13::jsonb, updated_at = NOW()
          WHERE id = $14`,
        params: [
          extraction.date, extraction.merchant, extraction.subtotal, extraction.tax, extraction.tip,
          extraction.total, extraction.currency, extraction.category, extraction.confidence,
          llm.name, llm.model, validation.status, validation, receiptId,
        ],
      },
      ...lineItemStatements(receiptId, extraction),
      {
        query: `UPDATE jobs SET status = 'done', result = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        params: [{ extraction, validation, provider: llm.name, model: llm.model }, jobId],
      },
      {
        query: `INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, after_json)
                VALUES ($1, $2, $3, $4, 'receipt_extracted', $5::jsonb)`,
        params: [newId("aud"), client.id, receiptId, actorUserId, { extraction, validation }],
      },
    ];

    if (bankTransactionId) {
      statements.push({
        query: `UPDATE bank_transactions SET
          triage = 'receipt_pending', pending_receipt_id = $1,
          suggested_receipt_id = NULL, suggested_score = NULL, suggested_reason = NULL,
          matched_receipt_id = NULL, resolution_reason = NULL,
          resolved_at = NULL, resolved_by_user_id = NULL,
          reviewed_at = NOW(), reviewed_by_user_id = $2
          WHERE id = $3 AND client_id = $4`,
        params: [receiptId, actorUserId, bankTransactionId, client.id],
      });
    }

    await db.transaction(statements);
    return { ok: true, receiptId, jobId, bankTransactionId };
  } catch (error) {
    const requestId = crypto.randomUUID();
    const message = error instanceof Error ? error.message : "extract failed";
    console.error(`[${requestId}] receipt extraction failed for ${receiptId}:`, error);
    await db.transaction([
      { query: `UPDATE jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`, params: [message, jobId] },
      { query: `UPDATE receipts SET status = 'failed', updated_at = NOW() WHERE id = $1`, params: [receiptId] },
    ]);
    return { ok: false, receiptId, jobId, error: "Receipt extraction failed", requestId };
  }
}

async function loadBusinessContext(db: Db, client: ClientRow): Promise<ReceiptBusinessContext> {
  const [profile] = await db.query<Record<string, unknown>>(
    `SELECT entity_type, industry, state, accounting_basis FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  const categories = await db.query<{ slug: string }>(
    `SELECT slug FROM categories WHERE client_id = $1 ORDER BY sort_order, LOWER(name)`,
    [client.id],
  );
  return {
    clientName: client.name,
    entityType: (profile?.entity_type as string | null | undefined) ?? null,
    industry: (profile?.industry as string | null | undefined) ?? null,
    state: (profile?.state as string | null | undefined) ?? null,
    accountingBasis: (profile?.accounting_basis as string | null | undefined) ?? null,
    categories: categories.map((category) => category.slug),
  };
}

async function applyCorrectionMemory(db: Db, clientId: string, extraction: ReceiptExtraction): Promise<ReceiptExtraction> {
  if (!extraction.merchant) return extraction;
  const [rule] = await db.query<{ output_json: { category?: string } | null }>(
    `SELECT output_json FROM correction_rules
     WHERE client_id = $1 AND rule_type = 'merchant_category' AND match_key = $2
     ORDER BY updated_at DESC LIMIT 1`,
    [clientId, normalizeMerchant(extraction.merchant)],
  );
  const remembered = rule?.output_json?.category;
  if (!remembered) return extraction;
  return {
    ...extraction,
    category: remembered,
    lineItems: extraction.lineItems.map((item) => ({ ...item, category: item.category ?? remembered })),
  };
}

function lineItemStatements(receiptId: string, extraction: ReceiptExtraction): DbStatement[] {
  return extraction.lineItems.map((item, index) => ({
    query: `INSERT INTO receipt_line_items
      (id, receipt_id, line_no, description, quantity, unit_price, amount, category, confidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    params: [newId("li"), receiptId, index + 1, item.description, item.quantity, item.unitPrice, item.amount, item.category, item.confidence],
  }));
}

function normalizeMerchant(merchant: string): string {
  return merchant.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
