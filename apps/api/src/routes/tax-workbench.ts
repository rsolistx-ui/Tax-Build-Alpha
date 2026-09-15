import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getWorkbench, updateReadiness } from "../services/tax-workbench";
import { runTaxDiagnostics } from "../services/tax-diagnostics";
import { TAX_READINESS_STATES, isProfessionalApprovalState, suggestReadinessState } from "../services/tax-readiness";

export const taxWorkbenchRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
taxWorkbenchRoutes.use("*", requireSession);

taxWorkbenchRoutes.get("/:clientId/workbench/:taxYear", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const taxYear = Number(c.req.param("taxYear"));
  const wb = await getWorkbench(db, client.id, taxYear);
  const diagnostics = await runTaxDiagnostics(db, client.id, firm.id, taxYear);
  const blocked = diagnostics.some((d: any) => d.severity === "error");
  void wb;
  const suggestion = suggestReadinessState(diagnostics as any);
  const extraction = await db.query<any>(
    `SELECT source_type, count(*) as c FROM (
       SELECT 'receipts' as source_type FROM receipts WHERE firm_id=$1 AND client_id=$2
       UNION ALL SELECT 'bank' FROM bank_transactions WHERE firm_id=$1 AND client_id=$2
       UNION ALL SELECT 'workpaper' FROM tax_workpapers WHERE firm_id=$3 AND client_id=$2
       UNION ALL SELECT 'm1' FROM m1_reconciliations WHERE firm_id=$3 AND client_id=$2
     ) t GROUP BY source_type`, [firm.id, client.id, firm.id]);
  const reviewQueue = await db.query<any>(
    `SELECT code, form_line_label as label, source_type FROM tax_form_mappings WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3 AND source_type='draft' ORDER BY sort_order LIMIT 25`,
    [firm.id, client.id, taxYear]);
  return c.json({ ...wb, diagnostics, blocked, suggestedReadiness: suggestion, extractionSummary: extraction, reviewQueue });
});

taxWorkbenchRoutes.patch("/:clientId/workbench/:taxYear/readiness", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ state: z.enum(TAX_READINESS_STATES as any) }).parse(await c.req.json());
  const taxYear = Number(c.req.param("taxYear"));
  const diagnostics = await runTaxDiagnostics(db, client.id, firm.id, taxYear);
  const hasErrors = diagnostics.some(d => d.severity === "error");
  if (hasErrors && isProfessionalApprovalState(body.state as any)) return c.json({ error: "Diagnostics errors block readiness", diagnostics }, 400);
  return c.json(await updateReadiness(db, client.id, body.state, c.get("userId")));
});
