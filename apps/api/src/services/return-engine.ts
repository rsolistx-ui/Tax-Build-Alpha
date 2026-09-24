import type { Db } from "../db";
import { newId } from "../lib/id";
import { runTaxDiagnostics } from "./tax-diagnostics";

export type ReturnStatus = "draft" | "transmitted" | "accepted" | "rejected" | "voided";

export async function createReturn(db: Db, firmId: string, clientId: string, taxYear: number, formType: string, actorUserId: string) {
  const wb = await db.query<any>(`SELECT status FROM tax_year_readiness WHERE client_id=$1 AND tax_year=$2`, [clientId, taxYear]);
  if (wb[0]?.status !== "ready_for_preparation" && wb[0]?.status !== "preparation_started") throw new Error("Workbench not ready — complete diagnostics and set readiness first (M7 gate)");
  const diagnostics = await runTaxDiagnostics(db, clientId, taxYear);
  if (diagnostics.some((d) => d.severity === "error")) throw new Error(`Diagnostics blocking: ${diagnostics.filter((d) => d.severity === "error").map((d) => d.code).join(", ")}`);
  const existing = await db.query<any>(`SELECT id FROM tax_returns WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3 AND form_type=$4 AND status NOT IN ('voided')`, [firmId, clientId, taxYear, formType]);
  if (existing.length) throw new Error(`Return already exists for ${formType} ${taxYear} (${existing[0].status})`);
  const id = newId("ret");
  const [row] = await db.query<any>(`INSERT INTO tax_returns (id,firm_id,client_id,tax_year,form_type,status) VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`, [id, firmId, clientId, taxYear, formType]);
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,'return_created',$4,$5::jsonb,NOW())`,
    [newId("aud"), firmId, clientId, actorUserId, JSON.stringify({ returnId: id, taxYear, formType })]);
  return row;
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
