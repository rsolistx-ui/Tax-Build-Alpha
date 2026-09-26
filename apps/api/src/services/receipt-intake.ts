import { createDb, type Db, type DbStatement } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { activeDocumentReaders, getLlmProvider, usCategorizerConfig, type ReceiptBusinessContext, type ReceiptExtraction } from "../providers/llm";
import { suggestCategory } from "../providers/llm/azure-openai-categorizer";
import { consentRequired, hasDocumentReadingConsent } from "./taxpayer-consent";
import { validateReceipt } from "../services/receipt-validation";
import type { ClientRow } from "../services/clients";
import { MAX_UPLOAD_BYTES } from "../services/documents";
import { delegateReceiptAgents } from "./agent-supervisor";
import { AdminRulesService } from "./admin-rules";

export type ReceiptIngestResult =
  | { ok: true; receiptId: string; jobId: string; bankTransactionId: string | null; readingSkipped?: "consent_required" }
  | { ok: false; receiptId: string; jobId: string; error: string; requestId: string; retryPending: boolean };

type ReceiptExtractionJobPayload = {
  receiptId: string;
  clientId: string;
  r2Key: string;
  bankTransactionId: string | null;
  actorUserId: string | null;
};

type ClaimedReceiptExtraction = ReceiptExtractionJobPayload & {
  id: string;
  attempt_count: number;
  claim_token: string;
};

type StoredReceiptResume = {
  receiptId: string;
  jobId: string;
  r2Key: string;
  claimToken: string;
};

class ReceiptExtractionClaimLostError extends Error {}

export type ReceiptExtractionRecoveryResult = {
  claimed: number;
  recovered: number;
  retried: number;
  deadLettered: number;
};

type ReceiptFailureDisposition = "retry" | "dead_letter" | "claim_lost";

const MAX_RECEIPT_EXTRACTION_ATTEMPTS = 4;
const STALE_RECEIPT_EXTRACTION_CLAIM_MINUTES = 15;

export function receiptExtractionRetryDelaySeconds(attemptCount: number): number {
  return Math.min(30 * 60, 60 * 2 ** Math.max(0, attemptCount - 1));
}

/**
 * Receipt-specific upload gate, narrower than the general document
 * whitelist (no docx/xlsx/csv - a receipt goes through image/PDF
 * extraction, per providers/llm/workers-ai.ts, which branches on
 * application/pdf and otherwise treats the file as an image). Both the
 * staff route and the portal missing_receipt route call
 * ingestReceiptForClient, so this single check protects both - server-
 * side, never trusting frontend validation.
 */
const RECEIPT_EXTENSION_CONTENT_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  heic: ["image/heic", "image/heif", "application/octet-stream"],
};

export function isSupportedReceiptUpload(filename: string, contentType: string | null): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const allowed = RECEIPT_EXTENSION_CONTENT_TYPES[ext];
  if (!allowed) return false;
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  if (!ct) return true;
  return allowed.includes(ct);
}

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
  resume?: StoredReceiptResume,
): Promise<ReceiptIngestResult> {
  if (file.size <= 0) {
    throw new HttpError(400, "file is empty");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit`);
  }
  if (!isSupportedReceiptUpload(file.name, file.type || null)) {
    throw new HttpError(400, "Unsupported file type. Supported: PDF, PNG, JPG, JPEG, HEIC.");
  }

  const documentClassification = classifyDocument(file);

  if (bankTransactionId && !resume) {
    const [bankTransaction] = await db.query<Record<string, unknown>>(
      `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
      [bankTransactionId, client.id],
    );
    if (!bankTransaction) throw new HttpError(404, "Bank transaction was not found");
    if (bankTransaction.triage === "matched" || bankTransaction.triage === "no_receipt_required") {
      throw new HttpError(409, "This bank transaction is already resolved");
    }
  }

  const receiptId = resume?.receiptId ?? newId("rcp");
  const jobId = resume?.jobId ?? newId("job");
  const claimToken = resume?.claimToken ?? jobId;
  const key = resume?.r2Key ?? `${client.firm_id}/${client.id}/${receiptId}/${file.name}`;
  const bytes = await file.arrayBuffer();

  if (resume) await assertReceiptExtractionClaim(db, jobId, claimToken);

  if (!resume) {
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
        query: `INSERT INTO jobs (id, type, payload, status, attempt_count, claimed_at, claim_token)
                VALUES ($1, 'receipt_extract', $2::jsonb, 'extracting', 1, NOW(), $3)`,
        params: [jobId, { receiptId, clientId: client.id, r2Key: key, bankTransactionId, actorUserId }, jobId],
      },
      {
        query: `UPDATE receipts SET status = 'extracting', updated_at = NOW() WHERE id = $1`,
        params: [receiptId],
      },
    ]);
  }

  // IRC § 7216: nothing is sent to an outside reading service without the
  // client's signed disclosure consent. The file is kept for manual entry.
  const readers = activeDocumentReaders(env);
  if (consentRequired(readers) && !(await hasDocumentReadingConsent(db, client.id, readers.map((r) => r.id)))) {
    await beginReceiptExtractionFinalization(db, jobId, claimToken);
    const statements: DbStatement[] = [
      {
        query: `UPDATE jobs SET status = 'done', result = $1::jsonb, claimed_at = NULL, claim_token = NULL, updated_at = NOW()
                WHERE id = $2 AND type = 'receipt_extract' AND status = 'finalizing' AND claim_token = $3`,
        params: [{ skipped: "consent_required" }, jobId, claimToken],
      },
      {
        query: `UPDATE receipts SET status = 'review', extracted_merchant = 'Manual entry needed', extracted_total = 0, confidence = 0,
          validation_status = 'fail', validation_json = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        params: [JSON.stringify({ status: "fail", checks: [{ code: "CONSENT_REQUIRED", label: "Client consent", status: "fail",
          message: "Automatic reading is off for this client until they sign the disclosure consent. The original is saved; enter the details by hand." }] }), receiptId],
      },
    ];
    if (bankTransactionId) {
      statements.push({
        query: `UPDATE bank_transactions SET triage = 'receipt_pending', pending_receipt_id = $1, reviewed_at = NOW(), reviewed_by_user_id = $2
          WHERE id = $3 AND client_id = $4`,
        params: [receiptId, actorUserId, bankTransactionId, client.id],
      });
    }
    await db.transaction(statements);
    return { ok: true, receiptId, jobId, bankTransactionId, readingSkipped: "consent_required" };
  }

  try {
    const llm = getLlmProvider(env);
    const context = await loadBusinessContext(db, client);
    const isMultiPage = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    let extraction = await llm.extractReceipt({
      bytes,
      contentType: file.type || "application/octet-stream",
      filename: file.name,
      context,
      isMultiPage,
    });
    const withMemory = await applyCorrectionMemory(db, client.id, extraction);
    extraction = applyDeterministicMarkdownRules(withMemory.extraction, context.markdownRules);
    // Document Intelligence deliberately reads receipt facts but does not make an
    // accounting judgment. Give the professional a conservative local suggestion
    // when the merchant/line text plainly matches one of the client's categories.
    // This remains an approval-gated agent task; it never categorizes or files a
    // receipt by itself.
    if (!extraction.category) {
      const suggested = suggestDeterministicCategory(extraction, context.categories ?? []);
      if (suggested) extraction = { ...extraction, category: suggested };
    }
    // US-only readers extract fields only; her rules and memory come first, then an optional US-pinned suggestion.
    const categorizer = !extraction.category ? usCategorizerConfig(env) : null;
    if (categorizer) {
      const suggested = await suggestCategory(categorizer, extraction, context).catch(() => null);
      if (suggested) extraction = { ...extraction, category: suggested };
    }
    const rememberedCategory = withMemory.rememberedCategory;
    const validation = validateReceipt(extraction);

    let duplicateOfReceiptId: string | null = null;
    let isPotentialDuplicate = false;

    if (extraction.merchant && extraction.total != null && extraction.date) {
      const [existingMatch] = await db.query<{ id: string; filename: string }>(
        `SELECT id, filename FROM receipts
         WHERE client_id = $1 AND id != $2
           AND LOWER(extracted_merchant) = LOWER($3)
           AND extracted_date = $4
           AND ABS(extracted_total - $5) < 0.05
           AND status != 'discarded'
         LIMIT 1`,
        [client.id, receiptId, extraction.merchant, extraction.date, extraction.total],
      );
      if (existingMatch) {
        duplicateOfReceiptId = existingMatch.id;
        isPotentialDuplicate = true;
      }
    }

    const statements: DbStatement[] = [
      {
        query: `UPDATE receipts SET
          status = 'review', extracted_date = $1, extracted_merchant = $2,
          extracted_subtotal = $3, extracted_tax = $4, extracted_tip = $5,
          extracted_total = $6, extracted_currency = $7, extracted_category = $8,
          confidence = $9, provider = $10, model = $11,
          validation_status = $12, validation_json = $13::jsonb,
          remembered_category = $15,
          is_potential_duplicate = $16, duplicate_of_receipt_id = $17,
          payment_method = $18, card_last4 = $19,
          updated_at = NOW()
          WHERE id = $14`,
        params: [
          extraction.date, extraction.merchant, extraction.subtotal, extraction.tax, extraction.tip,
          extraction.total, extraction.currency, extraction.category, extraction.confidence,
          llm.name, llm.model, validation.status, validation, receiptId, rememberedCategory,
          isPotentialDuplicate, duplicateOfReceiptId,
          extraction.paymentMethod ?? null, extraction.cardLast4 ?? null,
        ],
      },
      ...lineItemStatements(receiptId, extraction),
      {
        query: `UPDATE jobs SET status = 'done', result = $1::jsonb, claimed_at = NULL, claim_token = NULL, updated_at = NOW()
                WHERE id = $2 AND type = 'receipt_extract' AND status = 'finalizing' AND claim_token = $3`,
        params: [{ extraction, validation, provider: llm.name, model: llm.model }, jobId, claimToken],
      },
      {
        query: `INSERT INTO audit_events (id, client_id, receipt_id, actor_user_id, action, after_json)
                VALUES ($1, $2, $3, $4, 'receipt_extracted', $5::jsonb)`,
        params: [newId("aud"), client.id, receiptId, actorUserId, { extraction, validation }],
      },
      {
        query: `INSERT INTO document_classifications
          (id, client_id, receipt_id, document_type, confidence, classified_at)
          VALUES ($1, $2, $3, $4, $5, NOW())`,
        params: [newId("doc"), client.id, receiptId, documentClassification, 0.85],
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
      statements.push({
        query: `INSERT INTO audit_events
          (id, client_id, receipt_id, actor_user_id, action, after_json)
          VALUES ($1, $2, $3, $4, 'bank_receipt_linked_pending_review', $5::jsonb)`,
        params: [
          newId("aud"),
          client.id,
          receiptId,
          actorUserId,
          { id: bankTransactionId, transactionId: bankTransactionId, pendingReceiptId: receiptId, triage: "receipt_pending" },
        ],
      });
    }

    await beginReceiptExtractionFinalization(db, jobId, claimToken);
    await db.transaction(statements);
    try {
      await delegateReceiptAgents(db, {
        firmId: client.firm_id,
        clientId: client.id,
        receiptId,
        confidence: extraction.confidence,
        merchant: extraction.merchant,
        category: extraction.category,
        total: extraction.total,
        validationStatus: validation.status,
      });
    } catch (error) {
      // Evidence intake succeeded before this optional hand-off. Do not mark
      // source evidence failed because the supervisor queue is unavailable.
      console.error(`agent supervisor delegation failed for receipt ${receiptId}:`, error);
    }
    return { ok: true, receiptId, jobId, bankTransactionId };
  } catch (error) {
    if (error instanceof ReceiptExtractionClaimLostError) throw error;
    const requestId = crypto.randomUUID();
    const message = error instanceof Error ? error.message : "extract failed";
    console.error(`[${requestId}] receipt ${receiptId} extraction failed: ${message}`);
    const failure = await recordReceiptExtractionFailure(db, receiptId, jobId, message, claimToken);
    if (failure === "claim_lost") throw new ReceiptExtractionClaimLostError("Receipt extraction claim is no longer current");
    const retryPending = failure === "retry";
    return { ok: false, receiptId, jobId, error: retryPending ? "Receipt extraction is queued for automatic retry" : "Receipt extraction failed; routed to review queue", requestId, retryPending };
  }
}

async function assertReceiptExtractionClaim(db: Db, jobId: string, claimToken: string): Promise<void> {
  const current = await db.query<{ id: string }>(
    `SELECT id FROM jobs WHERE id = $1 AND type = 'receipt_extract' AND status = 'extracting' AND claim_token = $2`,
    [jobId, claimToken],
  );
  if (!current.length) throw new ReceiptExtractionClaimLostError("Receipt extraction claim is no longer current");
}

async function beginReceiptExtractionFinalization(db: Db, jobId: string, claimToken: string): Promise<void> {
  const finalizing = await db.query<{ id: string }>(
    `UPDATE jobs SET status = 'finalizing', updated_at = NOW()
     WHERE id = $1 AND type = 'receipt_extract' AND status = 'extracting' AND claim_token = $2
     RETURNING id`,
    [jobId, claimToken],
  );
  if (!finalizing.length) throw new ReceiptExtractionClaimLostError("Receipt extraction claim is no longer current");
}

async function recordReceiptExtractionFailure(db: Db, receiptId: string, jobId: string, message: string, claimToken: string): Promise<ReceiptFailureDisposition> {
  const failedJob = await db.query<{ status: string }>(
      `UPDATE jobs
       SET status = CASE WHEN attempt_count >= $1 THEN 'failed' ELSE 'retry_pending' END,
           error = $2,
           next_attempt_at = CASE WHEN attempt_count >= $1 THEN NULL ELSE NOW() + (LEAST(1800, 60 * POWER(2, GREATEST(0, attempt_count - 1))) * INTERVAL '1 second') END,
           claimed_at = NULL,
           claim_token = NULL,
           updated_at = NOW()
       WHERE id = $3 AND type = 'receipt_extract' AND status IN ('extracting', 'finalizing')
         AND claim_token = $4
       RETURNING status`,
      [MAX_RECEIPT_EXTRACTION_ATTEMPTS, message, jobId, claimToken],
  );
  const retryPending = failedJob[0]?.status === "retry_pending";
  // A newer worker owns the job now. It alone may alter the visible review
  // state, so a late failure cannot overwrite its extraction result.
  if (!failedJob.length) return "claim_lost";
  const validationPayload = JSON.stringify({
      status: "fail",
      checks: [
        {
          code: retryPending ? "OCR_RETRY_PENDING" : "OCR_UNREADABLE",
          label: "AI Optical Character Recognition",
          status: "fail",
          message: retryPending
            ? "The AI could not automatically extract this file. The original is saved and Truepost will retry automatically; you may enter the details by hand now."
            : `The AI could not automatically extract data from this file (${message}). Original evidence is saved; please enter details manually.`,
        },
      ],
    });
  await db.query(
    `UPDATE receipts SET
          status = 'review',
          extracted_merchant = 'Unreadable / Blurry Receipt (Manual Review)',
          extracted_total = 0,
          confidence = 0,
          validation_status = 'fail',
           validation_json = $1::jsonb,
           updated_at = NOW()
     WHERE id = $2`,
    [validationPayload, receiptId],
  );
  return retryPending ? "retry" : "dead_letter";
}

/**
 * Recovers only receipts whose original source object and job already exist.
 * The intake path remains synchronous for a fast first answer, while this
 * bounded worker path handles provider outages without asking the client to
 * upload the same evidence again. Jobs are fenced by a claim token and use a
 * finite retry budget; a permanent failure remains visible in manual review.
 * The R2 source is intentionally retained with the receipt evidence; a
 * terminal extraction job never deletes taxpayer evidence.
 */
export async function recoverReceiptExtractions(env: Env, limit = 10): Promise<ReceiptExtractionRecoveryResult> {
  return recoverReceiptExtractionsWithDb(createDb(env), env, limit);
}

export async function recoverReceiptExtractionsWithDb(db: Db, env: Env, limit = 10): Promise<ReceiptExtractionRecoveryResult> {
  const claimed = await claimDueReceiptExtractions(db, limit);
  const result: ReceiptExtractionRecoveryResult = { claimed: claimed.length, recovered: 0, retried: 0, deadLettered: 0 };

  for (const job of claimed) {
    try {
      const [stored] = await db.query<ClientRow & { filename: string; content_type: string | null; r2_key: string }>(
        `SELECT c.*, r.filename, r.content_type, r.r2_key
         FROM receipts r JOIN clients c ON c.id = r.client_id
         WHERE r.id = $1 AND r.client_id = $2 AND r.r2_key = $3`,
        [job.receiptId, job.clientId, job.r2Key],
      );
      if (!stored) throw new Error("Receipt recovery source record is no longer available");
      const source = await env.RECEIPTS.get(stored.r2_key);
      if (!source) throw new Error("Receipt recovery source object is no longer available");

      const file = new File([await source.arrayBuffer()], stored.filename, { type: stored.content_type || "application/octet-stream" });
      const attempt = await ingestReceiptForClient(
        db,
        env,
        stored,
        file,
        job.actorUserId,
        job.bankTransactionId,
        { receiptId: job.receiptId, jobId: job.id, r2Key: job.r2Key, claimToken: job.claim_token },
      );
      if (attempt.ok) result.recovered += 1;
      else if (attempt.retryPending) result.retried += 1;
      else result.deadLettered += 1;
    } catch (error) {
      if (error instanceof ReceiptExtractionClaimLostError) continue;
      const message = error instanceof Error ? error.message : "receipt recovery failed";
      console.error(`[receipt-extraction-recovery] ${job.id}: ${message}`);
      const failure = await recordReceiptExtractionFailure(db, job.receiptId, job.id, message, job.claim_token);
      if (failure === "retry") result.retried += 1;
      else if (failure === "dead_letter") result.deadLettered += 1;
    }
  }
  return result;
}

async function claimDueReceiptExtractions(db: Db, limit: number): Promise<ClaimedReceiptExtraction[]> {
  const rows = await db.query<ClaimedReceiptExtraction>(
    `WITH recovered AS (
       UPDATE jobs
       SET status = 'retry_pending', claimed_at = NULL, claim_token = NULL, next_attempt_at = NOW(), updated_at = NOW(),
           error = COALESCE(error, 'Recovered after stale receipt extraction claim')
       WHERE type = 'receipt_extract' AND status IN ('extracting', 'finalizing')
         AND claimed_at < NOW() - ($1 * INTERVAL '1 minute')
     ), due AS (
       SELECT id FROM jobs
       WHERE type = 'receipt_extract' AND status = 'retry_pending' AND next_attempt_at <= NOW()
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE jobs j
     SET status = 'extracting', attempt_count = j.attempt_count + 1, claimed_at = NOW(),
         claim_token = md5(j.id || clock_timestamp()::text || random()::text), updated_at = NOW()
     FROM due
     WHERE j.id = due.id
     RETURNING j.id, j.payload->>'receiptId' AS "receiptId", j.payload->>'clientId' AS "clientId",
       j.payload->>'r2Key' AS "r2Key", j.payload->>'bankTransactionId' AS "bankTransactionId",
       j.payload->>'actorUserId' AS "actorUserId", j.attempt_count, j.claim_token`,
    [STALE_RECEIPT_EXTRACTION_CLAIM_MINUTES, Math.max(1, Math.min(limit, 50))],
  );
  return rows.filter((row) => Boolean(row.receiptId && row.clientId && row.r2Key));
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
  const rulesService = new AdminRulesService(db);
  const markdownRules = await rulesService.compileActiveRulesMarkdown(client.firm_id, client.id);

  return {
    clientName: client.name,
    entityType: (profile?.entity_type as string | null | undefined) ?? null,
    industry: (profile?.industry as string | null | undefined) ?? null,
    state: (profile?.state as string | null | undefined) ?? null,
    accountingBasis: (profile?.accounting_basis as string | null | undefined) ?? null,
    categories: categories.map((category) => category.slug),
    markdownRules: markdownRules || undefined,
  };
}

async function applyCorrectionMemory(
  db: Db,
  clientId: string,
  extraction: ReceiptExtraction,
): Promise<{ extraction: ReceiptExtraction; rememberedCategory: string | null }> {
  if (!extraction.merchant) return { extraction, rememberedCategory: null };
  const [rule] = await db.query<{ output_json: { category?: string } | null }>(
    `SELECT output_json FROM correction_rules
     WHERE client_id = $1 AND rule_type = 'merchant_category' AND match_key = $2
     ORDER BY updated_at DESC LIMIT 1`,
    [clientId, normalizeMerchant(extraction.merchant)],
  );
  const remembered = rule?.output_json?.category;
  if (!remembered) return { extraction, rememberedCategory: null };
  return {
    extraction: {
      ...extraction,
      category: remembered,
      lineItems: extraction.lineItems.map((item) => ({ ...item, category: item.category ?? remembered })),
    },
    rememberedCategory: remembered,
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

export function classifyDocument(file: File): "W-2" | "1099" | "return" | "statement" | "generic_receipt" {
  const filename = file.name.toLowerCase();
  const ext = filename.split(".").pop() || "";
  const content = file.type.toLowerCase();

  if (filename.includes("w2") || filename.includes("w-2")) return "W-2";
  if (filename.includes("1099")) return "1099";
  if (filename.includes("return") || filename.includes("tax_return")) return "return";
  if (filename.includes("statement") || filename.includes("bank") || filename.includes("account")) return "statement";
  if (ext === "pdf" && (content.includes("pdf") || content === "")) return "generic_receipt";
  if (["png", "jpg", "jpeg", "heic"].includes(ext || "")) return "generic_receipt";

  return "generic_receipt";
}

export function applyDeterministicMarkdownRules(
  extraction: ReceiptExtraction,
  markdownRules?: string,
): ReceiptExtraction {
  if (!markdownRules || !extraction.merchant) return extraction;

  const merchantLower = extraction.merchant.toLowerCase();
  const total = extraction.total || 0;
  let targetCategory: string | null = null;

  // Split into individual rule blocks (separated by --- or ### Rule:)
  const ruleBlocks = markdownRules.split(/(?=### Rule:)|(?=---\n)/);

  for (const block of ruleBlocks) {
    const bLower = block.toLowerCase();

    // Check if this rule block pertains to the extracted merchant
    const matchesMerchant =
      (bLower.includes("home depot") && merchantLower.includes("home depot")) ||
      (bLower.includes("lowe's") && merchantLower.includes("lowe")) ||
      (bLower.includes("costco") && merchantLower.includes("costco")) ||
      (bLower.includes("amazon") && merchantLower.includes("amazon")) ||
      (bLower.includes("staples") && merchantLower.includes("staples")) ||
      (bLower.includes("shell") && merchantLower.includes("shell")) ||
      (bLower.includes("exxon") && merchantLower.includes("exxon")) ||
      (bLower.includes("chevron") && merchantLower.includes("chevron")) ||
      (bLower.includes("starbucks") && merchantLower.includes("starbucks")) ||
      (bLower.includes("panera") && merchantLower.includes("panera"));

    if (matchesMerchant) {
      // Check for dollar threshold rules
      const thresholdMatches = block.match(/(?:>|over|exceeds?)\s*\$?(\d+(?:\.\d{2})?)/i);
      const underMatches = block.match(/(?:<|under|less than|<=)\s*\$?(\d+(?:\.\d{2})?)/i);

      if (thresholdMatches && total > parseFloat(thresholdMatches[1])) {
        const catMatch = block.match(/(?:>|over)\s*\$?\d+.*?(?:=>|->|to|into|as)\s*["']?([^"\n\r,]+)["']?/i);
        if (catMatch) targetCategory = catMatch[1].trim();
      } else if (underMatches && total <= parseFloat(underMatches[1])) {
        const catMatch = block.match(/(?:<|under|<=)\s*\$?\d+.*?(?:=>|->|to|into|as)\s*["']?([^"\n\r,]+)["']?/i);
        if (catMatch) targetCategory = catMatch[1].trim();
      } else {
        const generalCatMatch = block.match(/(?:category|classify|bucket|into)\s*(?:is|as|to)?\s*["']?([A-Za-z0-9 &/-]+)["']?/i);
        if (generalCatMatch) targetCategory = generalCatMatch[1].trim();
      }
    }
  }

  if (targetCategory) {
    return {
      ...extraction,
      category: targetCategory,
      lineItems: extraction.lineItems.map((item) => ({
        ...item,
        category: item.category || targetCategory,
      })),
    };
  }

  return extraction;
}

/**
 * A deliberately small, local suggestion layer for receipts read by a factual
 * OCR provider. It only returns a category already present for this client and
 * only when the receipt text contains an unambiguous, ordinary-language match.
 * The caller presents the result for professional approval.
 */
export function suggestDeterministicCategory(extraction: ReceiptExtraction, categories: string[]): string | null {
  const text = [extraction.merchant, ...extraction.lineItems.map((item) => item.description)]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const bySlug = new Map(categories.map((category) => [category.trim().toLowerCase(), category]));
  const commonMatches: Array<[string, RegExp]> = [
    ["supplies", /\b(?:supply|supplies|office|stationery)\b/i],
    ["hotel", /\b(?:hotel|motel|lodging)\b/i],
    ["travel", /\b(?:airline|flight|rental car|uber|lyft|taxi|train)\b/i],
    ["food", /\b(?:restaurant|cafe|coffee|meal|catering)\b/i],
  ];
  for (const [slug, pattern] of commonMatches) {
    const category = bySlug.get(slug);
    if (category && pattern.test(text)) return category;
  }

  // Custom categories can still be suggested, but only when every meaningful
  // word in their slug appears verbatim in the evidence text.
  for (const category of categories) {
    const words = category.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
    if (words.length > 0 && words.every((word) => new RegExp(`\\b${word}\\b`, "i").test(text))) return category;
  }
  return null;
}
