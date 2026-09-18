import type { Db } from "../db";

export type SyncEntity =
  | "receipt"
  | "client"
  | "workpaper"
  | "tax_return"
  | "document"
  | "booking"
  | "bank_txn";

export type SyncOp = "create" | "update" | "delete";

export async function appendSyncEvent(
  db: Db,
  firmId: string,
  userId: string,
  entity: SyncEntity,
  entityId: string,
  op: SyncOp,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO sync_events (id, firm_id, user_id, entity, entity_id, op, payload, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [crypto.randomUUID(), firmId, userId, entity, entityId, op, payload, new Date().toISOString()],
    );
  } catch { /* table may not exist on first deploy before migration — non-fatal */ }
}

export async function firePushes(db: Db, whereUserId: string, title: string, body: string): Promise<void> {
  try {
    const subs = await db.query<any>(
      `SELECT endpoint FROM push_subscriptions WHERE user_id=$1`,
      [whereUserId],
    );
    for (const sub of subs) {
      try {
        await fetch(sub.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", TTL: "60" },
          body: JSON.stringify({ title, body, icon: "/icons/icon-192.png" }),
        });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}