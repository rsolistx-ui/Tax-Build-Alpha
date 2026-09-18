import type { Db } from "../db";
import { newId } from "../lib/id";
import { runTaxDiagnostics } from "./tax-diagnostics";

export type ReturnStatus = "draft" | "transmitted" | "accepted" | "rejected" | "voided";

export async function createReturn(db: Db, firmId: string, clientId: string, taxYear: number, formType: string) {
  const wb = await db.query<any>(`SELECT readiness_state FROM client_profiles WHERE client_id=$1`, [clientId]);
  if (wb[0]?.readiness_state !== "ready_for_preparation" && wb[0]?.readiness_state !== "preparation_started") throw new Error("Workbench not ready — complete diagnostics and set readiness first (M7 gate)");
  const diagnostics = await runTaxDiagnostics(db, clientId, taxYear);
  if (diagnostics.some((d) => d.severity === "error")) throw new Error(`Diagnostics blocking: ${diagnostics.filter((d) => d.severity === "error").map((d) => d.code).join(", ")}`);
  const existing = await db.query<any>(`SELECT id FROM tax_returns WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3 AND form_type=$4 AND status NOT IN ('voided')`, [firmId, clientId, taxYear, formType]);
  if (existing.length) throw new Error(`Return already exists for ${formType} ${taxYear} (${existing[0].status})`);
  const id = newId("ret");
  const [row] = await db.query<any>(`INSERT INTO tax_returns (id,firm_id,client_id,tax_year,form_type,status) VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`, [id, firmId, clientId, taxYear, formType]);
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) SELECT $1,$2,$3,'return_created',$4,$5::jsonb,NOW() FROM (SELECT $6::text) _ WHERE EXISTS (SELECT 1 FROM db.query)`,
    [crypto.randomUUID(), firmId, clientId, "system", JSON.stringify({ returnId: id, taxYear, formType })]
  ).catch(() => {});
  return row;
}

export async function submitReturn(db: Db, firmId: string, clientId: string, returnId: string) {
  const [r] = await db.query<any>(`SELECT * FROM tax_returns WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [returnId, firmId, clientId]);
  if (!r) throw new Error("Return not found");
  if (r.status !== "draft") throw new Error("Only draft returns can be submitted");
  const submissionId = `FOLIO-${r.tax_year}-${r.form_type}-${returnId.slice(0, 8).toUpperCase()}`;
  await db.query(`UPDATE tax_returns SET status='transmitted', mef_submission_id=$1, updated_at=NOW() WHERE id=$2`, [submissionId, returnId]);
  await db.query(`INSERT INTO tax_diagnostics_cache (id, client_id, tax_year, diagnostics, created_at) VALUES ($1,$2,$3,$4::jsonb,NOW()) ON CONFLICT DO NOTHING`,
    [crypto.randomUUID(), clientId, r.tax_year, JSON.stringify({ submittedAt: new Date().toISOString(), mefSubmissionId: submissionId })]).catch(() => {});
  return { ...r, status: "transmitted" as const, mef_submission_id: submissionId };
}

export async function ackReturn(db: Db, firmId: string, clientId: string, returnId: string, raw?: any) {
  const [r] = await db.query<any>(`SELECT * FROM tax_returns WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [returnId, firmId, clientId]);
  if (!r) throw new Error("Return not found");
  if (r.status !== "transmitted") throw new Error("Only transmitted returns can be accepted");
  await db.query(`UPDATE tax_returns SET status='accepted', updated_at=NOW() WHERE id=$1`, [returnId]);
  if (raw) await db.query(`INSERT INTO docusign_webhook_events (id, envelope_id, event, envelope_status, payload) VALUES ($1,$2,$3,$4,$5)`,
    [crypto.randomUUID(), returnId, "mef_ack", "accepted", JSON.stringify(raw)]);
  return { ...r, status: "accepted" as const };
}

export async function rejectReturn(db: Db, firmId: string, clientId: string, returnId: string, rejectionCode: string, detail?: string) {
  const [r] = await db.query<any>(`SELECT * FROM tax_returns WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [returnId, firmId, clientId]);
  if (!r) throw new Error("Return not found");
  if (r.status !== "transmitted" && r.status !== "rejected") throw new Error(`Cannot reject from status ${r.status}`);
  await db.query(`UPDATE tax_returns SET status='rejected', updated_at=NOW() WHERE id=$1`, [returnId]);
  await db.query(`INSERT INTO docusign_webhook_events (id, envelope_id, event, envelope_status, payload) VALUES ($1,$2,$3,$4,$5)`,
    [crypto.randomUUID(), returnId, "mef_reject", "rejected", JSON.stringify({ rejectionCode, detail, at: new Date().toISOString() })]);
  return { ...r, status: "rejected" as const, rejectionCode, detail };
}

export async function resolveRejection(db: Db, firmId: string, clientId: string, returnId: string) {
  const [r] = await db.query<any>(`SELECT * FROM tax_returns WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [returnId, firmId, clientId]);
  if (!r) throw new Error("Return not found");
  if (r.status !== "rejected") throw new Error("Only rejected returns can be resolved");
  await db.query(`UPDATE tax_returns SET status='draft', updated_at=NOW() WHERE id=$1`, [returnId]);
  return { ...r, status: "draft" as const };
}

export async function voidReturn(db: Db, firmId: string, clientId: string, returnId: string, reason: string) {
  const [r] = await db.query<any>(`SELECT * FROM tax_returns WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [returnId, firmId, clientId]);
  if (!r) throw new Error("Return not found");
  if (r.status === "voided" || r.status === "accepted") throw new Error(`Cannot void an ${r.status} return`);
  await db.query(`UPDATE tax_returns SET status='voided', updated_at=NOW() WHERE id=$1`, [returnId]);
  await db.query(`INSERT INTO docusign_webhook_events (id, envelope_id, event, envelope_status, payload) VALUES ($1,$2,$3,$4,$5)`,
    [crypto.randomUUID(), returnId, "voided", "voided", JSON.stringify({ reason, at: new Date().toISOString() })]);
  return { ...r, status: "voided" as const };
}
