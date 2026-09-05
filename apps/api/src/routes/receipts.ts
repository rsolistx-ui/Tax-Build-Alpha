import { Hono } from "hono";
import { z } from "zod";
import { createDb, type Db, type DbStatement } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient, type ClientRow } from "../services/clients";
import { newId } from "../lib/id";
import { getLlmProvider, type ReceiptBusinessContext, type ReceiptExtraction } from "../providers/llm";
import { validateReceipt } from "../services/receipt-validation";

export const receiptRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
receiptRoutes.use("*", requireSession);

const lineItemSchema = z.object({
  description: z.string().max(500),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number().nullable(),
  category: z.string().max(100).nullable(),
  confidence: z.number().min(0).max(1).default(1),
});

const reviewSchema = z.object({
  date: z.string().nullable(),
  merchant: z.string().max(300).nullable(),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  total: z.number().nullable(),
  currency: z.string().length(3),
  category: z.string().max(100).nullable(),
  confidence: z.number().min(0).max(1).default(1),
  lineItems: z.array(lineItemSchema).max(500),
});

type ReceiptRow = Record<string, unknown> & {
  id: string;
  status: string;
  extracted_category: string | null;
  validation_status: "pending" | "pass" | "warning" | "fail";
};

type ReceiptDetail = ReceiptRow & {
  lineItems: Array<{
    id: unknown;
    lineNo: unknown;
    description: unknown;
    quantity: unknown;
    unitPrice: unknown;
    amount: unknown;
    category: unknown;
    confidence: unknown;
  }>;
  source_url: string;
};

receiptRoutes.get("/:clientId/receipts", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const status = c.req.query("status") || null;
  const receipts = await db.query(
    `SELECT * FROM receipts
     WHERE client_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC
     LIMIT 200`,
    [client.id, status],
  );
  return c.json({ receipts });
});

receiptRoutes.post("/:clientId/receipts", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const form = await c.req.formData();
  const entry = form.get("file");
  if (!entry || typeof entry === "string") return c.json({ error: "file is required" }, 400);
  const file = entry as File;
  if (file.size <= 0) return c.json({ error: "file is empty" }, 400);

  const bankTransactionValue = form.get("bankTransactionId");
  const bankTransactionId = typeof bankTransactionValue === "string" && bankTransactionValue.trim()
    ? bankTransactionValue.trim()
    : null;
  let bankTransactionBefore: Record<string, unknown> | null = null;
  if (bankTransactionId) {
    const [bankTransaction] = await db.query<Record<string, unknown>>(
      `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
      [bankTransactionId, client.id],
    );
    if (!bankTransaction) return c.json({ error: "Bank transaction was not found" }, 404);
    if (bankTransaction.triage === "matched" || bankTransaction.triage === "no_receipt_required") {
      return c.json({ error: "This bank transaction is already resolved" }, 409);
    }
    bankTransactionBefore = bankTransaction;
  }

  const receiptId = newId("rcp");
  const jobId = newId("job");
  const key = `${client.firm_id}/${client.id}/${receiptId}/${file.name}`;
  const bytes = await file.arrayBuffer();

  await c.env.RECEIPTS.put(key, bytes, {
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
    const llm = getLlmProvider(c.env);
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
          extraction.date,
          extraction.merchant,
          extraction.subtotal,
          extraction.tax,
          extraction.tip,
          extraction.total,
          extraction.currency,
          extraction.category,
          extraction.confidence,
          llm.name,
          llm.model,
          validation.status,
          validation,
          receiptId,
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
        params: [newId("aud"), client.id, receiptId, c.get("userId"), { extraction, validation }],
      },
    ];

    if (bankTransactionId && bankTransactionBefore) {
      statements.push(
        {
          query: `UPDATE bank_transactions SET
            triage = 'receipt_pending', pending_receipt_id = $1,
            suggested_receipt_id = NULL, suggested_score = NULL, suggested_reason = NULL,
            matched_receipt_id = NULL, resolution_reason = NULL,
            resolved_at = NULL, resolved_by_user_id = NULL,
            reviewed_at = NOW(), reviewed_by_user_id = $2
            WHERE id = $3 AND client_id = $4`,
          params: [receiptId, c.get("userId"), bankTransactionId, client.id],
        },
        {
          query: `INSERT INTO audit_events
            (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
            VALUES ($1, $2, $3, $4, 'bank_receipt_uploaded', $5::jsonb, $6::jsonb)`,
          params: [
            newId("aud"),
            client.id,
            receiptId,
            c.get("userId"),
            bankTransactionBefore,
            { id: bankTransactionId, transactionId: bankTransactionId, triage: "receipt_pending", pending_receipt_id: receiptId },
          ],
        },
      );
    }

    await db.transaction(statements);

    return c.json({ receipt: await getReceiptDetails(db, receiptId, client.id), jobId, bankTransactionId }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "extract failed";
    await db.transaction([
      {
        query: `UPDATE jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        params: [message, jobId],
      },
      {
        query: `UPDATE receipts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        params: [receiptId],
      },
    ]);
    return c.json({ receiptId, jobId, error: message }, 500);
  }
});

receiptRoutes.get("/:clientId/review", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const receipts = await db.query<{ id: string }>(
    `SELECT id FROM receipts WHERE client_id = $1 AND status = 'review' ORDER BY created_at DESC`,
    [client.id],
  );
  const detailed = await Promise.all(receipts.map((receipt) => getReceiptDetails(db, receipt.id, client.id)));
  return c.json({ receipts: detailed.filter(Boolean) });
});

receiptRoutes.get("/:clientId/receipts/:receiptId/source", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const [receipt] = await db.query<{ r2_key: string; content_type: string | null; filename: string }>(
    `SELECT r2_key, content_type, filename FROM receipts WHERE id = $1 AND client_id = $2`,
    [c.req.param("receiptId"), client.id],
  );
  if (!receipt) return c.json({ error: "Not found" }, 404);

  const object = await c.env.RECEIPTS.get(receipt.r2_key);
  if (!object) return c.json({ error: "Source object missing" }, 404);
  const filename = receipt.filename.replace(/["\r\n]/g, "");
  return new Response(object.body, {
    headers: {
      "content-type": receipt.content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
});

receiptRoutes.patch("/:clientId/receipts/:receiptId", async (c) => {
  const body = reviewSchema.parse(await c.req.json());
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const receiptId = c.req.param("receiptId");
  const before = await getReceiptDetails(db, receiptId, client.id);
  if (!before) return c.json({ error: "Not found" }, 404);
  if (before.status !== "review") return c.json({ error: "Only receipts in review can be edited" }, 409);

  const extraction: ReceiptExtraction = {
    date: body.date,
    merchant: body.merchant,
    subtotal: body.subtotal,
    tax: body.tax,
    tip: body.tip,
    total: body.total,
    currency: body.currency.toUpperCase(),
    category: body.category,
    confidence: body.confidence,
    lineItems: body.lineItems,
  };
  const validation = validateReceipt(extraction);
  const statements: DbStatement[] = [
    {
      query: `UPDATE receipts SET
        extracted_date = $1, extracted_merchant = $2, extracted_subtotal = $3,
        extracted_tax = $4, extracted_tip = $5, extracted_total = $6,
        extracted_currency = $7, extracted_category = $8, confidence = $9,
        validation_status = $10, validation_json = $11::jsonb, updated_at = NOW()
        WHERE id = $12 AND client_id = $13`,
      params: [
        extraction.date,
        extraction.merchant,
        extraction.subtotal,
        extraction.tax,
        extraction.tip,
        extraction.total,
        extraction.currency,
        extraction.category,
        extraction.confidence,
        validation.status,
        validation,
        receiptId,
        client.id,
      ],
    },
    { query: `DELETE FROM receipt_line_items WHERE receipt_id = $1`, params: [receiptId] },
    ...lineItemStatements(receiptId, extraction),
    {
      query: `INSERT INTO audit_events
        (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
        VALUES ($1, $2, $3, $4, 'receipt_review_edited', $5::jsonb, $6::jsonb)`,
      params: [newId("aud"), client.id, receiptId, c.get("userId"), before, { extraction, validation }],
    },
  ];

  const beforeCategory = typeof before.extracted_category === "string" ? before.extracted_category : null;
  if (extraction.merchant && extraction.category && extraction.category !== beforeCategory) {
    statements.push(correctionRuleStatement(client.id, extraction.merchant, extraction.category));
  }

  await db.transaction(statements);
  return c.json({ receipt: await getReceiptDetails(db, receiptId, client.id) });
});

receiptRoutes.post("/:clientId/receipts/:receiptId/approve", async (c) => {
  const body = z.object({ confirmOverride: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);
  const receiptId = c.req.param("receiptId");
  const receipt = await getReceiptDetails(db, receiptId, client.id);
  if (!receipt) return c.json({ error: "Not found" }, 404);
  if (receipt.status !== "review") return c.json({ error: "Receipt is not in review" }, 409);
  if (receipt.validation_status === "fail" && !body.confirmOverride) {
    return c.json({ error: "Validation failed. Confirm the evidence before overriding." }, 409);
  }

  let categoryId: string | null = null;
  if (receipt.extracted_category) {
    const [category] = await db.query<{ id: string }>(
      `SELECT id FROM categories WHERE client_id = $1 AND slug = $2 LIMIT 1`,
      [client.id, String(receipt.extracted_category).toLowerCase()],
    );
    categoryId = category?.id ?? null;
  }

  const pendingBankTransactions = await db.query<Record<string, unknown>>(
    `SELECT * FROM bank_transactions
     WHERE client_id = $1 AND pending_receipt_id = $2 AND triage = 'receipt_pending'`,
    [client.id, receiptId],
  );

  const statements: DbStatement[] = [
    {
      query: `UPDATE receipts SET status = 'filed', category_id = $1, reviewed_at = NOW(),
              reviewed_by_user_id = $2, updated_at = NOW()
              WHERE id = $3 AND client_id = $4`,
      params: [categoryId, c.get("userId"), receiptId, client.id],
    },
    {
      query: `INSERT INTO audit_events
        (id, client_id, receipt_id, actor_user_id, action, after_json)
        VALUES ($1, $2, $3, $4, 'receipt_filed', $5::jsonb)`,
      params: [
        newId("aud"),
        client.id,
        receiptId,
        c.get("userId"),
        { validation_status: receipt.validation_status, override: Boolean(body.confirmOverride) },
      ],
    },
  ];

  for (const bankTransaction of pendingBankTransactions) {
    const transactionId = String(bankTransaction.id);
    statements.push(
      {
        query: `UPDATE bank_transactions SET
          triage = 'matched', matched_receipt_id = $1, pending_receipt_id = NULL,
          suggested_receipt_id = NULL, suggested_score = NULL, suggested_reason = NULL,
          resolution_reason = NULL, resolved_at = NOW(), resolved_by_user_id = $2,
          reviewed_at = NOW(), reviewed_by_user_id = $2
          WHERE id = $3 AND client_id = $4 AND pending_receipt_id = $1`,
        params: [receiptId, c.get("userId"), transactionId, client.id],
      },
      {
        query: `INSERT INTO audit_events
          (id, client_id, receipt_id, actor_user_id, action, before_json, after_json)
          VALUES ($1, $2, $3, $4, 'bank_match_confirmed', $5::jsonb, $6::jsonb)`,
        params: [
          newId("aud"),
          client.id,
          receiptId,
          c.get("userId"),
          bankTransaction,
          {
            id: transactionId,
            transactionId,
            triage: "matched",
            matched_receipt_id: receiptId,
            resolutionSource: "pending_receipt_filed",
          },
        ],
      },
    );
  }

  await db.transaction(statements);

  return c.json({
    receipt: await getReceiptDetails(db, receiptId, client.id),
    resolvedBankTransactions: pendingBankTransactions.map((transaction) => String(transaction.id)),
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
    lineItems: extraction.lineItems.map((item) => ({
      ...item,
      category: item.category ?? remembered,
    })),
  };
}

function lineItemStatements(receiptId: string, extraction: ReceiptExtraction): DbStatement[] {
  return extraction.lineItems.map((item, index) => ({
    query: `INSERT INTO receipt_line_items
      (id, receipt_id, line_no, description, quantity, unit_price, amount, category, confidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    params: [
      newId("li"),
      receiptId,
      index + 1,
      item.description,
      item.quantity,
      item.unitPrice,
      item.amount,
      item.category,
      item.confidence,
    ],
  }));
}

function correctionRuleStatement(clientId: string, merchant: string, category: string): DbStatement {
  return {
    query: `INSERT INTO correction_rules
      (id, client_id, rule_type, match_key, output_json, seen_count, last_applied_at)
      VALUES ($1, $2, 'merchant_category', $3, $4::jsonb, 1, NOW())
      ON CONFLICT (client_id, rule_type, match_key) DO UPDATE SET
        output_json = EXCLUDED.output_json,
        seen_count = correction_rules.seen_count + 1,
        last_applied_at = NOW(),
        updated_at = NOW()`,
    params: [newId("rule"), clientId, normalizeMerchant(merchant), { category }],
  };
}

async function getReceiptDetails(db: Db, receiptId: string, clientId: string): Promise<ReceiptDetail | undefined> {
  const [receipt] = await db.query<ReceiptRow>(
    `SELECT * FROM receipts WHERE id = $1 AND client_id = $2`,
    [receiptId, clientId],
  );
  if (!receipt) return undefined;
  const lineItems = await db.query<Record<string, unknown>>(
    `SELECT id, line_no, description, quantity, unit_price, amount, category, confidence
     FROM receipt_line_items WHERE receipt_id = $1 ORDER BY line_no`,
    [receiptId],
  );
  return {
    ...receipt,
    lineItems: lineItems.map((item) => ({
      id: item.id,
      lineNo: item.line_no,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      amount: item.amount,
      category: item.category,
      confidence: item.confidence,
    })),
    source_url: `/api/clients/${clientId}/receipts/${receiptId}/source`,
  };
}

function normalizeMerchant(merchant: string): string {
  return merchant.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
