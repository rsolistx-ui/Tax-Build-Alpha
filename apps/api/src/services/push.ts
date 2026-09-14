import type { Db } from "../db";
import { newId } from "../lib/id";

export async function listSubs(db: Db, userId: string) {
  return db.query<any>(`SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id=$1`, [userId]);
}

export async function addSub(db: Db, firmId: string, userId: string, endpoint: string, p256dh: string, auth: string) {
  const id = newId("push");
  const [row] = await db.query<any>(`INSERT INTO push_subscriptions (id,firm_id,user_id,endpoint,p256dh,auth) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth RETURNING *`, [id, firmId, userId, endpoint, p256dh, auth]);
  return row;
}

export async function removeSub(db: Db, userId: string, endpoint: string) {
  await db.query(`DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`, [userId, endpoint]);
}
