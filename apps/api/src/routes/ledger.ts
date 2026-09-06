import { Hono } from "hono";
import { z } from "zod";
import { createDb, type DbStatement } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { newId } from "../lib/id";

export const ledgerRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
ledgerRoutes.use("*", requireSession);

// Schema for transaction classification
const classifySchema = z.object({
  accountingClass: z.enum(["expense", "income", "transfer", "owner_contribution", "owner_draw", "needs_review"]),
  treatment: z.enum(["business", "personal"]),
  categoryId: z.string().nullable().optional(),
});

const categoryUpdateSchema = z.object({
  categoryId: z.string().nullable(),
});

// Get available periods for client
ledgerRoutes.get("/:clientId/ledger/periods", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const periods = await db.query<{ period_key: string }>(
    `SELECT DISTINCT period_key FROM ledger_entries WHERE client_id = $1 ORDER BY period_key DESC`,
    [client.id],
  );

  // Also include periods from bank_transactions and receipts that might not have ledger entries yet
  const bankPeriods = await db.query<{ period_key: string }>(
    `SELECT DISTINCT to_char(txn_date, 'YYYY-MM') AS period_key
     FROM bank_transactions
     WHERE client_id = $1 AND txn_date IS NOT NULL
     ORDER BY period_key DESC`,
    [client.id],
  );

  const receiptPeriods = await db.query<{ period_key: string }>(
    `SELECT DISTINCT to_char(extracted_date, 'YYYY-MM') AS period_key
     FROM receipts
     WHERE client_id = $1 AND extracted_date IS NOT NULL
     ORDER BY period_key DESC`,
    [client.id],
  );

  const allPeriods = new Set([
    ...periods.map((p) => p.period_key),
    ...bankPeriods.map((p) => p.period_key),
    ...receiptPeriods.map((p) => p.period_key),
  ]);

  return c.json({ periods: Array.from(allPeriods).sort().reverse() });
});

// List ledger entries with filters
ledgerRoutes.get("/:clientId/ledger", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const period = c.req.query("period") || null;
  const accountingClass = c.req.query("class") || null;
  const treatment = c.req.query("treatment") || null;
  const categoryId = c.req.query("categoryId") || null;
  const search = c.req.query("search") || null;
  const limit = Math.min(parseInt(c.req.query("limit") || "200"), 500);
  const offset = parseInt(c.req.query("offset") || "0");

  let whereClause = "WHERE le.client_id = $1";
  const params: unknown[] = [client.id];
  let paramIndex = 2;

  if (period) {
    whereClause += ` AND le.period_key = $${paramIndex}`;
    params.push(period);
    paramIndex++;
  }
  if (accountingClass) {
    whereClause += ` AND le.accounting_class = $${paramIndex}`;
    params.push(accountingClass);
    paramIndex++;
  }
  if (treatment) {
    whereClause += ` AND le.treatment = $${paramIndex}`;
    params.push(treatment);
    paramIndex++;
  }
  if (categoryId) {
    whereClause += ` AND le.category_id = $${paramIndex}`;
    params.push(categoryId);
    paramIndex++;
  }
  if (search) {
    whereClause += ` AND (le.description ILIKE $${paramIndex} OR le.amount::text ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
       le.*,
       c.name AS category_name,
       c.slug AS category_slug,
       bt.description AS bank_description,
       bt.amount AS bank_amount,
       bt.txn_date AS bank_date,
       r.extracted_merchant AS receipt_merchant,
       r.extracted_total AS receipt_total,
       r.extracted_date AS receipt_date
     FROM ledger_entries le
     LEFT JOIN categories c ON c.id = le.category_id
     LEFT JOIN bank_transactions bt ON bt.id = le.source_bank_transaction_id
     LEFT JOIN receipts r ON r.id = le.source_receipt_id
     ${whereClause}
     ORDER BY le.entry_date DESC NULLS LAST, le.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset],
  );

  const entries = rows.map(serializeLedgerEntry);
  const totalResult = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ledger_entries le ${whereClause}`,
    params,
  );
  const total = parseInt(totalResult[0]?.count || "0", 10);

  return c.json({ entries, total, limit, offset });
});

// Update transaction classification (accounting class + treatment)
ledgerRoutes.patch("/:clientId/ledger/:entryId/classify", async (c) => {
  const body = classifySchema.parse(await c.req.json());
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const entryId = c.req.param("entryId");
  const userId = c.get("userId");

  // Check if entry exists and period is open
  const [entry] = await db.query<{ id: string; period_key: string; accounting_class: string; treatment: string }>(
    `SELECT id, period_key, accounting_class, treatment FROM ledger_entries WHERE id = $1 AND client_id = $2`,
    [entryId, client.id],
  );
  if (!entry) return c.json({ error: "Not found" }, 404);

  // Check period state
  const [period] = await db.query<{ state: string }>(
    `SELECT state FROM accounting_periods WHERE client_id = $1 AND period_key = $2`,
    [client.id, entry.period_key],
  );
  if (period?.state === "closed") {
    return c.json({ error: "Cannot mutate accounting in a closed period" }, 409);
  }

  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM ledger_entries WHERE id = $1 AND client_id = $2`,
    [entryId, client.id],
  );

  const [after] = await db.query<Record<string, unknown>>(
    `UPDATE ledger_entries SET
       accounting_class = $1,
       treatment = $2,
       category_id = $3,
       reviewed_at = NOW(),
       reviewed_by_user_id = $4
     WHERE id = $5 AND client_id = $6
     RETURNING *`,
    [body.accountingClass, body.treatment, body.categoryId ?? null, userId, entryId, client.id],
  );

  await logLedgerAudit(db, client.id, entryId, userId, "ledger_entry_classified", before, after);

  return c.json({ entry: serializeLedgerEntry(after) });
});

// Update transaction category
ledgerRoutes.patch("/:clientId/ledger/:entryId/category", async (c) => {
  const body = categoryUpdateSchema.parse(await c.req.json());
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const entryId = c.req.param("entryId");
  const userId = c.get("userId");

  const [entry] = await db.query<{ id: string; period_key: string; category_id: string | null }>(
    `SELECT id, period_key, category_id FROM ledger_entries WHERE id = $1 AND client_id = $2`,
    [entryId, client.id],
  );
  if (!entry) return c.json({ error: "Not found" }, 404);

  // Check period state
  const [period] = await db.query<{ state: string }>(
    `SELECT state FROM accounting_periods WHERE client_id = $1 AND period_key = $2`,
    [client.id, entry.period_key],
  );
  if (period?.state === "closed") {
    return c.json({ error: "Cannot mutate accounting in a closed period" }, 409);
  }

  // Verify category belongs to client if provided
  if (body.categoryId) {
    const [category] = await db.query<{ id: string }>(
      `SELECT id FROM categories WHERE id = $1 AND client_id = $2`,
      [body.categoryId, client.id],
    );
    if (!category) return c.json({ error: "Category not found" }, 404);
  }

  const [before] = await db.query<Record<string, unknown>>(
    `SELECT * FROM ledger_entries WHERE id = $1 AND client_id = $2`,
    [entryId, client.id],
  );

  const [after] = await db.query<Record<string, unknown>>(
    `UPDATE ledger_entries SET
       category_id = $1,
       reviewed_at = NOW(),
       reviewed_by_user_id = $2
     WHERE id = $3 AND client_id = $4
     RETURNING *`,
    [body.categoryId, userId, entryId, client.id],
  );

  await logLedgerAudit(db, client.id, entryId, userId, "ledger_entry_category_changed", before, after);

  return c.json({ entry: serializeLedgerEntry(after) });
});

// Period summary
ledgerRoutes.get("/:clientId/periods/:periodKey/summary", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const periodKey = c.req.param("periodKey");
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return c.json({ error: "Invalid period key format. Use YYYY-MM" }, 400);
  }

  // Get period state
  const [period] = await db.query<Record<string, unknown>>(
    `SELECT * FROM accounting_periods WHERE client_id = $1 AND period_key = $2`,
    [client.id, periodKey],
  );

  // Compute summary from ledger
  const summaryRows = await db.query<Record<string, unknown>>(
    `SELECT
       accounting_class,
       treatment,
       COUNT(*)::int AS count,
       COALESCE(SUM(amount), 0)::numeric AS total
     FROM ledger_entries
     WHERE client_id = $1 AND period_key = $2
     GROUP BY accounting_class, treatment`,
    [client.id, periodKey],
  );

  // Get blockers for period close
  const blockers: string[] = [];

  // 1. Unresolved bank exceptions
  const [unresolvedExceptions] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM bank_transactions
     WHERE client_id = $1
       AND to_char(txn_date, 'YYYY-MM') = $2
       AND triage IN ('unmatched', 'needs_review', 'likely_match', 'receipt_pending')
       AND triage NOT IN ('matched', 'no_receipt_required')`,
    [client.id, periodKey],
  );
  if (parseInt(unresolvedExceptions.count, 10) > 0) {
    blockers.push(`${unresolvedExceptions.count} unresolved bank exception(s)`);
  }

  // 2. Pending linked receipts
  const [pendingReceipts] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM bank_transactions
     WHERE client_id = $1
       AND to_char(txn_date, 'YYYY-MM') = $2
       AND pending_receipt_id IS NOT NULL`,
    [client.id, periodKey],
  );
  if (parseInt(pendingReceipts.count, 10) > 0) {
    blockers.push(`${pendingReceipts.count} pending linked receipt(s)`);
  }

  // 3. Uncategorized business ledger rows
  const [uncategorized] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM ledger_entries
     WHERE client_id = $1
       AND period_key = $2
       AND treatment = 'business'
       AND accounting_class IN ('expense', 'income')
       AND category_id IS NULL`,
    [client.id, periodKey],
  );
  if (parseInt(uncategorized.count, 10) > 0) {
    blockers.push(`${uncategorized.count} uncategorized business ledger row(s)`);
  }

  // 4. Receipt review items in period
  const [reviewReceipts] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM receipts
     WHERE client_id = $1
       AND status = 'review'
       AND to_char(extracted_date, 'YYYY-MM') = $2`,
    [client.id, periodKey],
  );
  if (parseInt(reviewReceipts.count, 10) > 0) {
    blockers.push(`${reviewReceipts.count} receipt(s) in review`);
  }

  // 5. Needs review transaction classes
  const [needsReview] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM ledger_entries
     WHERE client_id = $1
       AND period_key = $2
       AND accounting_class = 'needs_review'`,
    [client.id, periodKey],
  );
  if (parseInt(needsReview.count, 10) > 0) {
    blockers.push(`${needsReview.count} ledger entry(ies) need review`);
  }

  const canClose = blockers.length === 0;

  return c.json({
    periodKey,
    state: period?.state || "open",
    summary: summaryRows.reduce((acc, row) => {
      const key = `${row.accounting_class}_${row.treatment}`;
      acc[key] = { count: Number(row.count), total: Number(row.total) };
      return acc;
    }, {} as Record<string, { count: number; total: number }>),
    blockers,
    canClose,
    closedAt: period?.closed_at ?? null,
    closedBy: period?.closed_by_user_id ?? null,
  });
});

// Close period
ledgerRoutes.post("/:clientId/periods/:periodKey/close", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const periodKey = c.req.param("periodKey");
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return c.json({ error: "Invalid period key format. Use YYYY-MM" }, 400);
  }
  const userId = c.get("userId");

  // Check current state
  const [period] = await db.query<Record<string, unknown>>(
    `SELECT * FROM accounting_periods WHERE client_id = $1 AND period_key = $2`,
    [client.id, periodKey],
  );

  if (period?.state === "closed") {
    return c.json({ error: "Period is already closed" }, 409);
  }

  // Re-check blockers at close time
  const [unresolvedExceptions] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM bank_transactions
     WHERE client_id = $1
       AND to_char(txn_date, 'YYYY-MM') = $2
       AND triage IN ('unmatched', 'needs_review', 'likely_match', 'receipt_pending')`,
    [client.id, periodKey],
  );
  if (parseInt(unresolvedExceptions.count, 10) > 0) {
    return c.json({ error: "Cannot close: unresolved bank exceptions exist" }, 409);
  }

  const [pendingReceipts] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM bank_transactions
     WHERE client_id = $1
       AND to_char(txn_date, 'YYYY-MM') = $2
       AND pending_receipt_id IS NOT NULL`,
    [client.id, periodKey],
  );
  if (parseInt(pendingReceipts.count, 10) > 0) {
    return c.json({ error: "Cannot close: pending linked receipts exist" }, 409);
  }

  const [uncategorized] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM ledger_entries
     WHERE client_id = $1
       AND period_key = $2
       AND treatment = 'business'
       AND accounting_class IN ('expense', 'income')
       AND category_id IS NULL`,
    [client.id, periodKey],
  );
  if (parseInt(uncategorized.count, 10) > 0) {
    return c.json({ error: "Cannot close: uncategorized business ledger rows exist" }, 409);
  }

  const [reviewReceipts] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM receipts
     WHERE client_id = $1
       AND status = 'review'
       AND to_char(extracted_date, 'YYYY-MM') = $2`,
    [client.id, periodKey],
  );
  if (parseInt(reviewReceipts.count, 10) > 0) {
    return c.json({ error: "Cannot close: receipts in review exist" }, 409);
  }

  const [needsReview] = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM ledger_entries
     WHERE client_id = $1
       AND period_key = $2
       AND accounting_class = 'needs_review'`,
    [client.id, periodKey],
  );
  if (parseInt(needsReview.count, 10) > 0) {
    return c.json({ error: "Cannot close: ledger entries need review" }, 409);
  }

  // Compute summary for storage
  const summaryRows = await db.query<Record<string, unknown>>(
    `SELECT
       accounting_class,
       treatment,
       COUNT(*)::int AS count,
       COALESCE(SUM(amount), 0)::numeric AS total
     FROM ledger_entries
     WHERE client_id = $1 AND period_key = $2
     GROUP BY accounting_class, treatment`,
    [client.id, periodKey],
  );

  const summary = summaryRows.reduce((acc, row) => {
    const key = `${row.accounting_class}_${row.treatment}`;
    acc[key] = { count: Number(row.count), total: Number(row.total) };
    return acc;
  }, {} as Record<string, { count: number; total: number }>);

  const statements: DbStatement[] = [
    {
      query: `INSERT INTO accounting_periods (client_id, period_key, state, summary, closed_at, closed_by_user_id, updated_at)
              VALUES ($1, $2, 'closed', $3::jsonb, NOW(), $4, NOW())
              ON CONFLICT (client_id, period_key) DO UPDATE SET
                state = 'closed',
                summary = EXCLUDED.summary,
                closed_at = NOW(),
                closed_by_user_id = EXCLUDED.closed_by_user_id,
                updated_at = NOW()
              RETURNING *`,
      params: [client.id, periodKey, summary, userId],
    },
    {
      query: `UPDATE ledger_entries SET closed_at = NOW(), closed_by_user_id = $1 WHERE client_id = $2 AND period_key = $3`,
      params: [userId, client.id, periodKey],
    },
    {
      query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
              VALUES ($1, $2, $3, 'period_closed', $4::jsonb)`,
      params: [newId("aud"), client.id, userId, { periodKey, summary }],
    },
  ];

  await db.transaction(statements);

  return c.json({ periodKey, state: "closed", closedAt: new Date().toISOString(), closedBy: userId });
});

// Reopen period
ledgerRoutes.post("/:clientId/periods/:periodKey/reopen", async (c) => {
  const body = z.object({ reason: z.string().min(5).max(500) }).parse(await c.req.json());
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const periodKey = c.req.param("periodKey");
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return c.json({ error: "Invalid period key format. Use YYYY-MM" }, 400);
  }
  const userId = c.get("userId");

  const [period] = await db.query<Record<string, unknown>>(
    `SELECT * FROM accounting_periods WHERE client_id = $1 AND period_key = $2`,
    [client.id, periodKey],
  );

  if (!period) return c.json({ error: "Period not found" }, 404);
  if (period.state === "open") return c.json({ error: "Period is already open" }, 409);

  const statements: DbStatement[] = [
    {
      query: `UPDATE accounting_periods SET
                state = 'open',
                reopened_at = NOW(),
                reopened_by_user_id = $1,
                reopened_reason = $2,
                updated_at = NOW()
              WHERE client_id = $3 AND period_key = $4
              RETURNING *`,
      params: [userId, body.reason, client.id, periodKey],
    },
    {
      query: `UPDATE ledger_entries SET closed_at = NULL, closed_by_user_id = NULL WHERE client_id = $1 AND period_key = $2`,
      params: [client.id, periodKey],
    },
    {
      query: `INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json)
              VALUES ($1, $2, $3, 'period_reopened', $4::jsonb)`,
      params: [newId("aud"), client.id, userId, { periodKey, reason: body.reason }],
    },
  ];

  await db.transaction(statements);

  return c.json({ periodKey, state: "open", reopenedAt: new Date().toISOString(), reopenedBy: userId, reason: body.reason });
});

// Period audit history
ledgerRoutes.get("/:clientId/periods/:periodKey/audit", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const periodKey = c.req.param("periodKey");
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return c.json({ error: "Invalid period key format. Use YYYY-MM" }, 400);
  }

  const events = await db.query<Record<string, unknown>>(
    `SELECT id, client_id, actor_user_id, action, before_json, after_json, created_at
     FROM audit_events
     WHERE client_id = $1
       AND action IN ('period_closed', 'period_reopened')
       AND after_json->>'periodKey' = $2
     ORDER BY created_at ASC`,
    [client.id, periodKey],
  );

  return c.json({
    periodKey,
    events: events.map((event) => ({
      id: String(event.id),
      action: String(event.action),
      actor: event.actor_user_id ? String(event.actor_user_id) : null,
      after: event.after_json ?? null,
      createdAt: event.created_at ? String(event.created_at) : null,
    })),
  });
});

// Ledger-backed P&L
ledgerRoutes.get("/:clientId/pnl/ledger", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const period = c.req.query("period") || null;
  const periodWhere = period ? "AND le.period_key = $2" : "";
  const params = [client.id];
  if (period) params.push(period);

  // Income: business + income class
  const incomeRows = await db.query<{ category_id: string; category_name: string; category_slug: string; total: string; count: string }>(
    `SELECT
       c.id AS category_id,
       c.name AS category_name,
       c.slug AS category_slug,
       COALESCE(SUM(le.amount), 0)::numeric AS total,
       COUNT(*)::int AS count
     FROM ledger_entries le
     LEFT JOIN categories c ON c.id = le.category_id
     WHERE le.client_id = $1
       AND le.treatment = 'business'
       AND le.accounting_class = 'income'
       ${periodWhere}
     GROUP BY c.id, c.name, c.slug
     ORDER BY total DESC`,
    params,
  );

  // Expenses: business + expense class
  const expenseRows = await db.query<{ category_id: string; category_name: string; category_slug: string; total: string; count: string }>(
    `SELECT
       c.id AS category_id,
       c.name AS category_name,
       c.slug AS category_slug,
       COALESCE(SUM(le.amount), 0)::numeric AS total,
       COUNT(*)::int AS count
     FROM ledger_entries le
     LEFT JOIN categories c ON c.id = le.category_id
     WHERE le.client_id = $1
       AND le.treatment = 'business'
       AND le.accounting_class = 'expense'
       ${periodWhere}
     GROUP BY c.id, c.name, c.slug
     ORDER BY total DESC`,
    params,
  );

  const income = incomeRows.reduce((sum, row) => sum + Number(row.total), 0);
  const expenses = expenseRows.reduce((sum, row) => sum + Number(row.total), 0);

  return c.json({
    period: period || "all",
    currency: "USD",
    income,
    expenses,
    net: income - expenses,
    byCategory: {
      income: incomeRows.map((row) => ({
        categoryId: row.category_id,
        category: row.category_name,
        slug: row.category_slug,
        total: Number(row.total),
        count: Number(row.count),
      })),
      expense: expenseRows.map((row) => ({
        categoryId: row.category_id,
        category: row.category_name,
        slug: row.category_slug,
        total: Number(row.total),
        count: Number(row.count),
      })),
    },
    note: "Built from canonical ledger. Business income/expense only. Transfers, owner contributions/draws, and personal items excluded.",
  });
});

// P&L drilldown from ledger
ledgerRoutes.get("/:clientId/pnl/ledger/drilldown", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Not found" }, 404);

  const categoryId = c.req.query("categoryId");
  const accountingClass = c.req.query("class"); // income or expense
  const period = c.req.query("period") || null;

  if (!categoryId || !accountingClass) {
    return c.json({ error: "categoryId and class (income|expense) are required" }, 400);
  }

  const periodWhere = period ? "AND le.period_key = $4" : "";
  const params = [client.id, categoryId, accountingClass];
  if (period) params.push(period);

  const entries = await db.query<Record<string, unknown>>(
    `SELECT
       le.*,
       c.name AS category_name,
       c.slug AS category_slug,
       bt.id AS bank_id,
       bt.description AS bank_description,
       bt.txn_date AS bank_date,
       r.id AS receipt_id,
       r.extracted_merchant AS receipt_merchant,
       r.extracted_total AS receipt_total,
       r.extracted_date AS receipt_date,
       r.filename AS receipt_filename
     FROM ledger_entries le
     LEFT JOIN categories c ON c.id = le.category_id
     LEFT JOIN bank_transactions bt ON bt.id = le.source_bank_transaction_id
     LEFT JOIN receipts r ON r.id = le.source_receipt_id
     WHERE le.client_id = $1
       AND le.category_id = $2
       AND le.accounting_class = $3
       AND le.treatment = 'business'
       ${periodWhere}
     ORDER BY le.entry_date DESC NULLS LAST, le.created_at DESC`,
    params,
  );

  return c.json({
    categoryId,
    accountingClass,
    entries: entries.map((entry) => ({
      id: entry.id,
      date: entry.entry_date,
      description: entry.description,
      amount: Number(entry.amount),
      currency: entry.currency,
      category: entry.category_name,
      source: {
        bankTransaction: entry.bank_id ? {
          id: entry.bank_id,
          description: entry.bank_description,
          date: entry.bank_date,
        } : null,
        receipt: entry.receipt_id ? {
          id: entry.receipt_id,
          merchant: entry.receipt_merchant,
          total: entry.receipt_total ? Number(entry.receipt_total) : null,
          date: entry.receipt_date,
          filename: entry.receipt_filename,
          sourceUrl: `/api/clients/${client.id}/receipts/${entry.receipt_id}/source`,
        } : null,
      },
    })),
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

async function logLedgerAudit(
  db: ReturnType<typeof createDb>,
  clientId: string,
  entryId: string,
  userId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  await db.query(
    `INSERT INTO audit_events
      (id, client_id, actor_user_id, action, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [newId("aud"), clientId, userId, action, before, after],
  );
}

function serializeLedgerEntry(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    periodKey: String(row.period_key),
    date: row.entry_date ? String(row.entry_date) : null,
    description: String(row.description ?? ""),
    amount: Number(row.amount ?? 0),
    currency: String(row.currency ?? "USD"),
    accountingClass: String(row.accounting_class ?? "needs_review"),
    treatment: String(row.treatment ?? "business"),
    category: row.category_id ? {
      id: String(row.category_id),
      name: row.category_name ? String(row.category_name) : null,
      slug: row.category_slug ? String(row.category_slug) : null,
    } : null,
    source: {
      bankTransaction: row.source_bank_transaction_id ? {
        id: String(row.source_bank_transaction_id),
        description: row.bank_description ? String(row.bank_description) : null,
        amount: row.bank_amount ? Number(row.bank_amount) : null,
        date: row.bank_date ? String(row.bank_date) : null,
      } : null,
      receipt: row.source_receipt_id ? {
        id: String(row.source_receipt_id),
        merchant: row.receipt_merchant ? String(row.receipt_merchant) : null,
        total: row.receipt_total ? Number(row.receipt_total) : null,
        date: row.receipt_date ? String(row.receipt_date) : null,
        sourceUrl: `/api/clients/${row.client_id}/receipts/${row.source_receipt_id}/source`,
      } : null,
    },
    createdAt: row.created_at ? String(row.created_at) : null,
    createdBy: row.created_by_user_id ? String(row.created_by_user_id) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by_user_id ? String(row.reviewed_by_user_id) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    closedBy: row.closed_by_user_id ? String(row.closed_by_user_id) : null,
  };
}