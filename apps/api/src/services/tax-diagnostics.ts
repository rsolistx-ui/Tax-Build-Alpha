import type { Db } from "../db";

export type Diagnostic = { code: string; severity: "error" | "warning"; message: string };

export async function runTaxDiagnostics(db: Db, clientId: string, firmId: string, taxYear: number): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];
  const journals = await db.query<any>(`SELECT id, status FROM tax_adjustment_journals WHERE client_id=$1 AND firm_id=$2 AND tax_year=$3`, [clientId, firmId, taxYear]);
  const drafts = journals.filter((j: any) => j.status === "draft");
  if (drafts.length) diags.push({ code: "DRAFT_JOURNALS", severity: "warning", message: `${drafts.length} draft adjustment journal(s) not yet posted` });
  const mappings = await db.query<any>(`SELECT count(*) as c FROM tax_form_mappings WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3`, [firmId, clientId, taxYear]);
  if (Number(mappings[0]?.c ?? 0) === 0) diags.push({ code: "NO_MAPPINGS", severity: "warning", message: "No tax form mappings for this year" });
  const m1 = await db.query<any>(`SELECT status FROM m1_reconciliations WHERE client_id=$1 AND tax_year=$2`, [clientId, taxYear]);
  if (m1.length && m1[0].status === "draft") diags.push({ code: "M1_DRAFT", severity: "warning", message: "M-1 reconciliation not finalized" });
  const cfs = await db.query<any>(`SELECT count(*) as c FROM tax_carryforwards WHERE client_id=$1 AND status='active' AND tax_year_expires IS NOT NULL AND tax_year_expires < $2`, [clientId, taxYear]);
  if (Number(cfs[0]?.c ?? 0) > 0) diags.push({ code: "CARRYFORWARD_EXPIRING", severity: "warning", message: `${cfs[0].c} carryforward(s) expiring before ${taxYear}` });
  const ext = await db.query<any>(`SELECT count(*) as c FROM tax_extensions WHERE client_id=$1 AND tax_year=$2 AND status='pending'`, [clientId, taxYear]);
  if (Number(ext[0]?.c ?? 0) > 0) diags.push({ code: "PENDING_EXTENSION", severity: "warning", message: `Extension pending for ${taxYear}` });
  return diags;
}
