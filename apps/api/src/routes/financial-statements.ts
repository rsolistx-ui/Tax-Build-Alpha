import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { newId } from "../lib/id";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { insertWorkAuditEvent } from "../services/work-audit";
import {
  ACCOUNT_KINDS,
  ASSIGNABLE_KINDS,
  buildBalanceSheet,
  buildCashFlow,
  loadStatementBooks,
  transactionsForLine,
  type AccountKind,
  type StatementBooks,
} from "../services/financial-statements";

/**
 * A client's money accounts and books start date, and the balance sheet and
 * cash flow statement built from them (services/financial-statements.ts).
 */
export const financialStatementRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function authorizedClient(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  return { db, firm, client };
}

function warningsFor(books: StatementBooks): string[] {
  const out: string[] = [];
  if (!books.booksStartDate) out.push("No books start date: opening balances are treated as zero and all history is counted.");
  if (books.accounts.length === 0) out.push("No accounts set up: all bank activity is shown as unassigned.");
  if (books.excluded.otherCurrency) out.push(`${books.excluded.otherCurrency} transaction(s) in another currency are left out.`);
  if (books.excluded.undated) out.push(`${books.excluded.undated} transaction(s) without a date are left out.`);
  return out;
}

financialStatementRoutes.get("/:clientId/accounts", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const [profile] = await db.query<{ books_start_date: string | null }>(
    `SELECT books_start_date::text AS books_start_date FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  const accounts = await db.query<{ id: string; name: string; kind: AccountKind; opening_balance: string; charges_positive: boolean; transaction_count: string }>(
    `SELECT a.id, a.name, a.kind, a.opening_balance, a.charges_positive,
            (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.account_id = a.id)::text AS transaction_count
       FROM client_accounts a WHERE a.client_id = $1 ORDER BY a.kind, lower(a.name)`,
    [client.id],
  );
  const batches = await db.query<{ import_batch_id: string | null; filename: string | null; currency: string | null; count: string; earliest: string | null; latest: string | null; account_ids: string[] | null }>(
    `SELECT raw_json->>'importBatchId' AS import_batch_id, MIN(raw_json->>'sourceFilename') AS filename,
            STRING_AGG(DISTINCT UPPER(currency), ', ') AS currency, COUNT(*)::text AS count,
            MIN(txn_date)::text AS earliest, MAX(txn_date)::text AS latest,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT account_id), NULL) AS account_ids
       FROM bank_transactions WHERE client_id = $1
      GROUP BY raw_json->>'importBatchId' ORDER BY MAX(created_at) DESC`,
    [client.id],
  );
  return c.json({
    booksStartDate: profile?.books_start_date ?? null,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, openingBalance: Number(a.opening_balance), chargesPositive: a.charges_positive === true, transactionCount: Number(a.transaction_count) })),
    importBatches: batches.map((b) => ({
      importBatchId: b.import_batch_id, filename: b.filename, currency: b.currency, transactionCount: Number(b.count),
      earliestDate: b.earliest, latestDate: b.latest, accountIds: b.account_ids ?? [],
    })),
  });
});

const accountBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(ACCOUNT_KINDS as [AccountKind, ...AccountKind[]]),
  openingBalance: z.number().finite().default(0),
  /** The issuer exports charges as positive numbers; imports into this account flip the signs. */
  chargesPositive: z.boolean().default(false),
});

financialStatementRoutes.post("/:clientId/accounts", async (c) => {
  const { db, firm, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const body = accountBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Give the account a name, a type, and an opening balance." }, 400);
  const id = newId("cacct");
  const [created] = await db.query<{ id: string }>(
    `INSERT INTO client_accounts (id, firm_id, client_id, name, kind, opening_balance, charges_positive) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
    [id, firm.id, client.id, body.data.name, body.data.kind, body.data.openingBalance, body.data.chargesPositive],
  );
  if (!created) return c.json({ error: "This client already has an account with that name." }, 409);
  await insertWorkAuditEvent(db, { firmId: firm.id, entityType: "client_account", entityId: id, action: "client_account_created", actorUserId: c.get("userId"), afterJson: { clientId: client.id, ...body.data } });
  return c.json({ id }, 201);
});

financialStatementRoutes.put("/:clientId/accounts/books-start", async (c) => {
  const { db, firm, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ date: isoDate.nullable() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Send a date as YYYY-MM-DD, or null to clear it." }, 400);
  await db.query(
    `INSERT INTO client_profiles (client_id, books_start_date) VALUES ($1, $2::date)
     ON CONFLICT (client_id) DO UPDATE SET books_start_date = EXCLUDED.books_start_date`,
    [client.id, body.data.date],
  );
  await insertWorkAuditEvent(db, { firmId: firm.id, entityType: "client", entityId: client.id, action: "books_start_date_set", actorUserId: c.get("userId"), afterJson: { booksStartDate: body.data.date } });
  return c.json({ ok: true, booksStartDate: body.data.date });
});

financialStatementRoutes.patch("/:clientId/accounts/:accountId", async (c) => {
  const { db, firm, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const body = accountBody.partial().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Check the account name, type, and opening balance." }, 400);
  const accountId = c.req.param("accountId");
  const [existing] = await db.query<{ kind: AccountKind; assigned: string }>(
    `SELECT kind, (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.account_id = a.id)::text AS assigned
       FROM client_accounts a WHERE a.id = $1 AND a.client_id = $2`,
    [accountId, client.id],
  );
  if (!existing) return c.json({ error: "Account not found" }, 404);
  if (body.data.kind && !ASSIGNABLE_KINDS.has(body.data.kind) && Number(existing.assigned) > 0) {
    return c.json({ error: "Bank activity is assigned to this account. Move it to another account before making it a loan." }, 409);
  }
  const [updated] = await db.query<{ id: string }>(
    `UPDATE client_accounts SET name = COALESCE($3, name), kind = COALESCE($4, kind),
            opening_balance = COALESCE($5, opening_balance), charges_positive = COALESCE($6, charges_positive), updated_at = NOW()
      WHERE id = $1 AND client_id = $2
        AND NOT EXISTS (SELECT 1 FROM client_accounts o WHERE o.client_id = $2 AND o.id <> $1 AND lower(o.name) = lower(COALESCE($3, '')))
      RETURNING id`,
    [accountId, client.id, body.data.name ?? null, body.data.kind ?? null, body.data.openingBalance ?? null, body.data.chargesPositive ?? null],
  );
  if (!updated) return c.json({ error: "This client already has an account with that name." }, 409);
  await insertWorkAuditEvent(db, { firmId: firm.id, entityType: "client_account", entityId: accountId, action: "client_account_updated", actorUserId: c.get("userId"), afterJson: body.data });
  return c.json({ ok: true });
});

financialStatementRoutes.delete("/:clientId/accounts/:accountId", async (c) => {
  const { db, firm, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const accountId = c.req.param("accountId");
  // Its transactions stay and become unassigned (ON DELETE SET NULL (account_id)).
  const [removed] = await db.query<{ id: string; name: string }>(
    `DELETE FROM client_accounts WHERE id = $1 AND client_id = $2 RETURNING id, name`,
    [accountId, client.id],
  );
  if (!removed) return c.json({ error: "Account not found" }, 404);
  await insertWorkAuditEvent(db, { firmId: firm.id, entityType: "client_account", entityId: accountId, action: "client_account_deleted", actorUserId: c.get("userId"), beforeJson: { name: removed.name } });
  return c.json({ ok: true });
});

/** Assigns every transaction from one bank CSV import to an account (or back to unassigned). */
financialStatementRoutes.post("/:clientId/accounts/assign-import", async (c) => {
  const { db, firm, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ importBatchId: z.string().min(1).nullable(), accountId: z.string().min(1).nullable() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Choose an import and an account." }, 400);
  if (body.data.accountId) {
    const [account] = await db.query<{ kind: AccountKind }>(`SELECT kind FROM client_accounts WHERE id = $1 AND client_id = $2`, [body.data.accountId, client.id]);
    if (!account) return c.json({ error: "Account not found" }, 404);
    if (!ASSIGNABLE_KINDS.has(account.kind)) return c.json({ error: "Bank activity goes to a checking, savings, or credit card account. Classify loan payments as loan instead." }, 400);
  }
  const updated = await db.query<{ id: string }>(
    `UPDATE bank_transactions SET account_id = $3
      WHERE client_id = $1 AND (raw_json->>'importBatchId') IS NOT DISTINCT FROM $2 RETURNING id`,
    [client.id, body.data.importBatchId, body.data.accountId],
  );
  await insertWorkAuditEvent(db, { firmId: firm.id, entityType: "client", entityId: client.id, action: "bank_import_assigned_to_account", actorUserId: c.get("userId"), afterJson: { ...body.data, transactions: updated.length } });
  return c.json({ ok: true, transactions: updated.length });
});

financialStatementRoutes.get("/:clientId/balance-sheet", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const asOf = isoDate.safeParse(c.req.query("asOf"));
  if (!asOf.success) return c.json({ error: "asOf must be YYYY-MM-DD" }, 400);
  const books = await loadStatementBooks(db, client.id);
  if (books.accrual) return c.json({ accrualUnsupported: true, error: "Balance sheets are cash basis. This client is set to accrual." }, 409);
  const balanceSheet = await buildBalanceSheet(db, client.id, books, asOf.data);
  return c.json({ asOf: asOf.data, currency: books.currency, booksStartDate: books.booksStartDate, balanceSheet, warnings: warningsFor(books) });
});

financialStatementRoutes.get("/:clientId/cash-flow", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const start = isoDate.safeParse(c.req.query("start"));
  const end = isoDate.safeParse(c.req.query("end"));
  if (!start.success || !end.success || start.data > end.data) return c.json({ error: "start and end must be YYYY-MM-DD, start first" }, 400);
  const books = await loadStatementBooks(db, client.id);
  if (books.accrual) return c.json({ accrualUnsupported: true, error: "Cash flow statements are cash basis. This client is set to accrual." }, 409);
  const cashFlow = await buildCashFlow(db, client.id, books, start.data, end.data);
  return c.json({ currency: books.currency, booksStartDate: books.booksStartDate, cashFlow, warnings: warningsFor(books) });
});

/** The bank transactions behind one statement line, newest first, capped at 500. */
financialStatementRoutes.get("/:clientId/statement-lines", async (c) => {
  const { db, client } = await authorizedClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const q = z.object({ line: z.string().min(1).max(80), start: isoDate.optional(), end: isoDate, cashOnly: z.enum(["true", "false"]).default("false") })
    .safeParse(c.req.query());
  if (!q.success) return c.json({ error: "line and end are required" }, 400);
  const books = await loadStatementBooks(db, client.id);
  const inRange = books.txns.filter((t) => t.date <= q.data.end && (!q.data.start || t.date >= q.data.start));
  const rows = transactionsForLine(q.data.line, inRange, books.accounts, q.data.cashOnly === "true").reverse();
  return c.json({
    total: rows.length,
    transactions: rows.slice(0, 500).map((t) => ({ id: t.id, date: t.date, description: t.description, amount: t.amount, disposition: t.disposition })),
  });
});
