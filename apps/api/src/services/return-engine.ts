import type { Db } from "../db";
import { newId } from "../lib/id";

export async function createReturn(db: Db, firmId: string, clientId: string, taxYear: number, formType: string) {
  const wb = await db.query<any>(`SELECT readiness_state FROM client_profiles WHERE client_id=$1`, [clientId]);
  if (wb[0]?.readiness_state !== "ready_for_preparation" && wb[0]?.readiness_state !== "preparation_started") throw new Error("Workbench not ready — complete diagnostics and set readiness first (M7 gate)");
  const id = newId("ret");
  const [row] = await db.query<any>(`INSERT INTO tax_returns (id,firm_id,client_id,tax_year,form_type,status) VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`, [id, firmId, clientId, taxYear, formType]);
  return row;
}

export async function submitReturn(db: Db, firmId: string, clientId: string, returnId: string) {
  const [r] = await db.query<any>(`SELECT * FROM tax_returns WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [returnId, firmId, clientId]);
  if (!r) throw new Error("Return not found");
  if (r.status !== "draft") throw new Error("Only draft returns can be submitted");
  await db.query(`UPDATE tax_returns SET status='transmitted', updated_at=NOW() WHERE id=$1`, [returnId]);
  return { ...r, status: "transmitted" };
}
