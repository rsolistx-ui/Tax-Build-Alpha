import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import {
  buildClientDashboardRow,
  buildDocumentWorkflowActions,
  sortActions,
  summarize,
  describeAuditEvent,
  type DashboardBankTxn,
  type DashboardReceipt,
  type DashboardClientMeta,
  type DashboardChecklistItem,
  type DashboardDocument,
} from "../services/dashboard";
import type { AnyDisposition } from "../services/pnl";
import { getUncategorizedReceiptLineCounts } from "../services/reporting";

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
dashboardRoutes.use("*", requireSession);
dashboardRoutes.use("*", requireActiveBeta);

/**
 * One firm-scoped query per table, never one per client. All classification
 * (readiness, action queue, priority) happens afterward in pure JS from
 * ./services/dashboard so the SQL here stays a thin, auditable data pull.
 */
dashboardRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const clientRows = await db.query<{
    id: string;
    name: string;
    legal_name: string | null;
    updated_at: string;
    tax_year: number | null;
    accounting_basis: string | null;
    default_currency: string | null;
  }>(
    `SELECT c.id, c.name, c.legal_name, c.updated_at, cp.tax_year, cp.accounting_basis, cp.default_currency
     FROM clients c
     LEFT JOIN client_profiles cp ON cp.client_id = c.id
     WHERE c.firm_id = $1
     ORDER BY LOWER(c.name)`,
    [firm.id],
  );

  if (clientRows.length === 0) {
    return c.json({
      summary: summarize([], []),
      clients: [],
      actions: [],
      recentActivity: [],
    });
  }

  const currencyByClient = new Map(clientRows.map((r) => [r.id, (r.default_currency || "USD").toUpperCase()]));

  const bankRows = await db.query<{
    id: string;
    client_id: string;
    txn_date: string | null;
    description: string | null;
    amount: number;
    disposition: string;
    triage: string;
    category_id: string | null;
    currency: string;
  }>(
    `SELECT bt.id, bt.client_id, bt.txn_date, bt.description, bt.amount, bt.disposition, bt.triage, bt.category_id, bt.currency
     FROM bank_transactions bt
     JOIN clients c ON c.id = bt.client_id
     WHERE c.firm_id = $1`,
    [firm.id],
  );

  const receiptRows = await db.query<{
    id: string;
    client_id: string;
    status: string;
    extracted_merchant: string | null;
    extracted_date: string | null;
    extracted_currency: string | null;
    category_id: string | null;
    matched_bank_disposition: string | null;
  }>(
    `SELECT r.id, r.client_id, r.status, r.extracted_merchant, r.extracted_date, r.extracted_currency, r.category_id,
            bt.disposition AS matched_bank_disposition
     FROM receipts r
     JOIN clients c ON c.id = r.client_id
     LEFT JOIN bank_transactions bt ON bt.matched_receipt_id = r.id AND bt.client_id = r.client_id
     WHERE c.firm_id = $1`,
    [firm.id],
  );

  const activityRows = await db.query<{
    id: string;
    client_id: string;
    client_name: string;
    action: string;
    actor_user_id: string | null;
    created_at: string;
  }>(
    `SELECT ae.id, ae.client_id, c.name AS client_name, ae.action, ae.actor_user_id, ae.created_at
     FROM audit_events ae
     JOIN clients c ON c.id = ae.client_id
     WHERE c.firm_id = $1
     ORDER BY ae.created_at DESC
     LIMIT 50`,
    [firm.id],
  );

  const checklistRows = await db.query<{
    id: string;
    client_id: string;
    tax_year: number;
    doc_type: string;
    custom_label: string | null;
    status: string;
  }>(
    `SELECT dci.id, dci.client_id, dci.tax_year, dci.doc_type, dci.custom_label, dci.status
     FROM document_checklist_items dci
     JOIN clients c ON c.id = dci.client_id
     WHERE c.firm_id = $1`,
    [firm.id],
  );

  const documentRows = await db.query<{
    id: string;
    client_id: string;
    filename: string;
    document_type: string;
    status: string;
  }>(
    `SELECT cd.id, cd.client_id, cd.filename, cd.document_type, cd.status
     FROM client_documents cd
     JOIN clients c ON c.id = cd.client_id
     WHERE c.firm_id = $1`,
    [firm.id],
  );

  const bankByClient = new Map<string, DashboardBankTxn[]>();
  for (const row of bankRows) {
    const list = bankByClient.get(row.client_id) ?? [];
    list.push({
      id: row.id,
      clientId: row.client_id,
      date: row.txn_date ? String(row.txn_date) : null,
      description: row.description,
      amount: Number(row.amount ?? 0),
      disposition: row.disposition as AnyDisposition,
      triage: row.triage || "unmatched",
      categoryId: row.category_id,
      currency: (row.currency || "USD").toUpperCase(),
    });
    bankByClient.set(row.client_id, list);
  }

  const receiptsByClient = new Map<string, DashboardReceipt[]>();
  for (const row of receiptRows) {
    const list = receiptsByClient.get(row.client_id) ?? [];
    const clientCurrency = currencyByClient.get(row.client_id) || "USD";
    list.push({
      id: row.id,
      clientId: row.client_id,
      status: row.status,
      merchant: row.extracted_merchant,
      date: row.extracted_date ? String(row.extracted_date) : null,
      currency: (row.extracted_currency || clientCurrency).toUpperCase(),
      categoryId: row.category_id,
      matchedBankDisposition: (row.matched_bank_disposition as AnyDisposition | null) ?? null,
    });
    receiptsByClient.set(row.client_id, list);
  }

  const checklistByClient = new Map<string, DashboardChecklistItem[]>();
  for (const row of checklistRows) {
    const list = checklistByClient.get(row.client_id) ?? [];
    list.push({
      id: row.id,
      clientId: row.client_id,
      taxYear: row.tax_year,
      docType: row.doc_type,
      customLabel: row.custom_label,
      status: row.status,
    });
    checklistByClient.set(row.client_id, list);
  }

  const documentsByClient = new Map<string, DashboardDocument[]>();
  for (const row of documentRows) {
    const list = documentsByClient.get(row.client_id) ?? [];
    list.push({
      id: row.id,
      clientId: row.client_id,
      filename: row.filename,
      documentType: row.document_type,
      status: row.status,
    });
    documentsByClient.set(row.client_id, list);
  }

  const uncategorizedReceiptLineCounts = await getUncategorizedReceiptLineCounts(db, clientRows.map((r) => r.id));

  const rows = [];
  const allActions = [];
  for (const c2 of clientRows) {
    const meta: DashboardClientMeta = {
      id: c2.id,
      name: c2.name,
      legalName: c2.legal_name,
      taxYear: c2.tax_year,
      accountingBasis: c2.accounting_basis,
      currency: (c2.default_currency || "USD").toUpperCase(),
      updatedAt: c2.updated_at,
    };
    const { row, actions } = buildClientDashboardRow(
      meta,
      bankByClient.get(c2.id) ?? [],
      receiptsByClient.get(c2.id) ?? [],
      uncategorizedReceiptLineCounts.get(c2.id) ?? 0,
    );
    const documentActions = buildDocumentWorkflowActions(
      c2.id,
      c2.name,
      checklistByClient.get(c2.id) ?? [],
      documentsByClient.get(c2.id) ?? [],
    );
    rows.push(row);
    allActions.push(...actions, ...documentActions);
  }

  const sortedActions = sortActions(allActions);
  const recentActivity = activityRows.map((r) =>
    describeAuditEvent({
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      action: r.action,
      actorUserId: r.actor_user_id,
      createdAt: r.created_at,
    }),
  );

  return c.json({
    summary: summarize(rows, sortedActions),
    clients: rows,
    actions: sortedActions,
    recentActivity,
  });
});
