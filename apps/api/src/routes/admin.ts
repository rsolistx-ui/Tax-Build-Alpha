import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireOwner } from "../middleware/beta";
import { ensureFirm } from "../services/firm";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
adminRoutes.use("*", requireSession);
adminRoutes.use("*", requireOwner);

adminRoutes.get("/metrics", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const [users] = await db.query<any>(`SELECT COUNT(DISTINCT user_id) as count FROM push_subscriptions WHERE user_id IN (SELECT user_id FROM clients WHERE firm_id=$1)`, [firm.id]);
  const [receipts] = await db.query<any>(`SELECT COUNT(*) as count FROM receipts WHERE firm_id=$1`, [firm.id]);
  const [feedback] = await db.query<any>(`SELECT COUNT(*) as count FROM feedback_submissions`, []);
  const [errors] = await db.query<any>(`SELECT COUNT(*) as count FROM audit_events WHERE action IN ('error','failed','exception')`, []);
  const [syncEvents] = await db.query<any>(`SELECT COUNT(*) as count FROM sync_events WHERE firm_id=$1`, [firm.id]);
  return c.json({
    users: parseInt(users?.count ?? "0"),
    receipts: parseInt(receipts?.count ?? "0"),
    feedback: parseInt(feedback?.count ?? "0"),
    errors: parseInt(errors?.count ?? "0"),
    syncEvents: parseInt(syncEvents?.count ?? "0"),
  });
});

adminRoutes.post("/report-daily", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const [stats] = await db.query<any>(`SELECT COUNT(DISTINCT s.user_id) as active_users, COUNT(*) as sync_events FROM sync_events s WHERE s.firm_id=$1 AND s.ts > NOW() - INTERVAL '1 day'`, [firm.id]);
  return c.json({ report: stats ?? { active_users: 0, sync_events: 0 } });
});
