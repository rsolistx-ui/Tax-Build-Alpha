import type { Db } from "../db";
import { newId } from "../lib/id";

export async function getWorkbench(db: Db, clientId: string, taxYear: number) {
  const diags = await db.query<any>(`SELECT * FROM tax_diagnostics_cache WHERE client_id=$1 AND tax_year=$2`, [clientId, taxYear]);
  const wp = await db.query<any>(`SELECT * FROM tax_workpapers WHERE client_id=$1 AND tax_year=$2`, [clientId, taxYear]);
  const readiness = await db.query<any>(`SELECT readiness_state FROM client_profiles WHERE client_id=$1`, [clientId]);
  return { diagnostics: diags, workpaper: wp[0] ?? null, readiness: readiness[0]?.readiness_state ?? "not_started" };
}

export async function updateReadiness(db: Db, clientId: string, state: string, actorUserId: string) {
  const professionalStates = new Set(["ready_for_preparation", "preparation_started", "complete"]);
  if (professionalStates.has(state)) {
    await db.query(`INSERT INTO audit_events (id, firm_id, client_id, actor_user_id, action, entity_type, entity_id, created_at) SELECT $1, firm_id, $2, $3, $4, 'readiness', $2, NOW() FROM clients WHERE id=$2`, [newId("aud"), clientId, actorUserId, `readiness:${state}`]);
  }
  await db.query(`UPDATE client_profiles SET readiness_state=$1, updated_at=NOW() WHERE client_id=$2`, [state, clientId]);
  return { readiness: state };
}
