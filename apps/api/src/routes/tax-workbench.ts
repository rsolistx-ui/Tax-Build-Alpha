import { Hono } from "hono";
import { visibleClientSql } from "../services/client-assignment";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { runTaxDiagnostics } from "../services/tax-diagnostics";
import { computeCanonicalReadiness, readinessBlockers, taxYearRange } from "./workspace";
import { assemblePnlReport, isAccrualUnsupported } from "../services/reporting";
import { priorYearChecklistCarryover } from "../services/documents";
import { suggestTaxFormForEntity } from "../services/tax-form-mappings";

export const taxWorkbenchRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

/**
 * One client's tax-year workbench: the single readiness row (tax_year_readiness,
 * the same one the Tax readiness tab writes), what blocks ready_for_preparation,
 * and the source counts behind it. Readiness is changed only through
 * PUT /tax-readiness/:taxYear, so there is one gate, not two.
 */
taxWorkbenchRoutes.get("/:clientId/workbench/:taxYear", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const taxYear = Number(c.req.param("taxYear"));
  if (!Number.isInteger(taxYear)) return c.json({ error: "taxYear must be an integer" }, 400);

  const [readiness] = await db.query<{ status: string; notes: string | null; updated_at: string }>(
    `SELECT status, notes, updated_at FROM tax_year_readiness WHERE client_id = $1 AND tax_year = $2`, [client.id, taxYear]);
  const [profileRow] = await db.query<{ accounting_basis: string | null; default_currency: string; entity_type: string | null }>(
    `SELECT accounting_basis, default_currency, entity_type FROM client_profiles WHERE client_id = $1`, [client.id]);
  const { startDate, endDate } = taxYearRange(taxYear);
  const { row } = await computeCanonicalReadiness(db, client, (profileRow?.default_currency || "USD").toUpperCase(), taxYear, profileRow?.accounting_basis ?? null, startDate, endDate);
  const diagnostics = await runTaxDiagnostics(db, client.id, taxYear);
  const [checklist] = await db.query<{ total: string; outstanding: string }>(
    `SELECT COUNT(*) FILTER (WHERE status <> 'not_applicable')::text AS total,
            COUNT(*) FILTER (WHERE status IN ('expected', 'requested'))::text AS outstanding
     FROM document_checklist_items WHERE client_id = $1 AND tax_year = $2`, [client.id, taxYear]);
  const [sources] = await db.query<{ workpaper: boolean; m1_status: string | null; mappings: string }>(
    `SELECT EXISTS(SELECT 1 FROM tax_workpapers WHERE firm_id = $1 AND client_id = $2 AND tax_year = $3) AS workpaper,
            (SELECT status FROM m1_reconciliations WHERE firm_id = $1 AND client_id = $2 AND tax_year = $3) AS m1_status,
            (SELECT COUNT(*) FROM tax_form_mappings WHERE client_id = $2 AND tax_year = $3)::text AS mappings`,
    [firm.id, client.id, taxYear]);
  // Same decision as PUT /tax-readiness (readinessBlockers), from facts already loaded above.
  const readyBlockers = readinessBlockers("ready_for_preparation", {
    bookkeepingReady: row.readiness === "ready",
    hasDiagnosticErrors: diagnostics.some((d) => d.severity === "error"),
    outstandingChecklistItems: Number(checklist?.outstanding ?? 0),
  });

  // Prior-year comparison: the same canonical P&L used everywhere else, for
  // this year and last year. Null when the client's basis is not reportable.
  const pnlTotals = async (year: number) => {
    const range = taxYearRange(year);
    const report = await assemblePnlReport(db, client.id, range.startDate, range.endDate);
    return isAccrualUnsupported(report) ? null : { income: report.income, expenses: report.expenses, net: report.net };
  };
  const checklistRows = (year: number) => db.query<{ doc_type: string; custom_label: string | null; status: string }>(
    `SELECT doc_type, custom_label, status FROM document_checklist_items WHERE client_id = $1 AND tax_year = $2`, [client.id, year]);
  const [currentTotals, priorTotals, priorChecklist, currentChecklist] = await Promise.all([
    pnlTotals(taxYear), pnlTotals(taxYear - 1), checklistRows(taxYear - 1), checklistRows(taxYear),
  ]);

  return c.json({
    client: { id: client.id, name: client.name },
    taxYear,
    status: readiness?.status ?? "not_started",
    notes: readiness?.notes ?? null,
    updatedAt: readiness?.updated_at ?? null,
    readyForPreparationBlockers: readyBlockers,
    diagnostics,
    bookkeeping: {
      readiness: row.readiness,
      receiptReviewCount: row.receiptReviewCount,
      missingEvidenceCount: row.missingEvidenceCount,
      unresolvedBankExceptionCount: row.unresolvedBankExceptionCount,
      unclassifiedCount: row.unclassifiedCount,
      uncategorizedCount: row.uncategorizedCount,
      currencyConflictCount: row.currencyConflictCount,
    },
    checklist: { total: Number(checklist?.total ?? 0), outstanding: Number(checklist?.outstanding ?? 0) },
    sources: { workpaper: Boolean(sources?.workpaper), m1Status: sources?.m1_status ?? null, mappingCount: Number(sources?.mappings ?? 0) },
    entityType: profileRow?.entity_type ?? null,
    suggestedTaxForm: suggestTaxFormForEntity(profileRow?.entity_type),
    priorYear: {
      taxYear: taxYear - 1,
      current: currentTotals,
      prior: priorTotals,
      checklistCarryoverCount: priorYearChecklistCarryover(priorChecklist, currentChecklist).length,
    },
  });
});

/** Firm-wide preparation status for one tax year: every client in one query, no per-client diagnostics. */
export const workbenchListRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
workbenchListRoutes.use("*", requireSession);
workbenchListRoutes.use("*", requireActiveBeta);

workbenchListRoutes.get("/:taxYear", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const taxYear = Number(c.req.param("taxYear"));
  if (!Number.isInteger(taxYear)) return c.json({ error: "taxYear must be an integer" }, 400);
  const rows = await db.query<{
    id: string; name: string; status: string; updated_at: string | null;
    tax_prep_required: boolean; checklist_total: string; checklist_outstanding: string;
  }>(
    `SELECT c.id, c.name, COALESCE(r.status, 'not_started') AS status, r.updated_at,
            COALESCE(p.profile->>'taxPrepRequired', 'false') = 'true' AS tax_prep_required,
            (SELECT COUNT(*) FROM document_checklist_items d WHERE d.client_id = c.id AND d.tax_year = $2 AND d.status <> 'not_applicable')::text AS checklist_total,
            (SELECT COUNT(*) FROM document_checklist_items d WHERE d.client_id = c.id AND d.tax_year = $2 AND d.status IN ('expected', 'requested'))::text AS checklist_outstanding
     FROM clients c
     LEFT JOIN tax_year_readiness r ON r.client_id = c.id AND r.tax_year = $2
     LEFT JOIN client_profiles p ON p.client_id = c.id
     WHERE c.firm_id = $1 AND ${visibleClientSql("c.id", "$3")}
     ORDER BY LOWER(c.name)`,
    [firm.id, taxYear, c.get("clientScopeUserId") ?? null]);
  return c.json({
    taxYear,
    clients: rows.map((r) => ({
      id: r.id, name: r.name, status: r.status, updatedAt: r.updated_at, taxPrepRequired: r.tax_prep_required,
      checklistTotal: Number(r.checklist_total), checklistOutstanding: Number(r.checklist_outstanding),
    })),
  });
});
