import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { listSubs, addSub, removeSub } from "../services/push";

export const pushRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
pushRoutes.use("*", requireSession);

pushRoutes.get("/subscriptions", async (c) => {
  const db = createDb(c.env);
  return c.json({ subscriptions: await listSubs(db, c.get("userId")) });
});

pushRoutes.post("/subscriptions", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({ endpoint: z.string(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(await c.req.json());
  return c.json({ subscription: await addSub(db, firm.id, c.get("userId"), body.endpoint, body.keys.p256dh, body.keys.auth) }, 201);
});

pushRoutes.delete("/subscriptions", async (c) => {
  const db = createDb(c.env);
  const body = z.object({ endpoint: z.string() }).parse(await c.req.json().catch(() => ({})));
  const endpoint = body.endpoint || (c.req.query("endpoint") as string);
  if (!endpoint) return c.json({ error: "endpoint required" }, 400);
  await removeSub(db, c.get("userId"), endpoint);
  return c.json({ ok: true });
});

pushRoutes.post("/notify", async (c) => {
  const db = createDb(c.env);
  const body = z.object({
    clientId: z.string().optional(),
    userId: z.string().optional(),
    message: z.string(),
    eventType: z.enum(["tax_readiness", "missing_receipt", "extension_due", "review_complete", "agent_recommendation"]).optional(),
  }).parse(await c.req.json());
  const where = body.clientId
    ? `WHERE user_id IN (SELECT user_id FROM clients WHERE id=$1)`
    : body.userId
    ? `WHERE user_id=$1`
    : "";
  const params = body.clientId ? [body.clientId] : body.userId ? [body.userId] : [];
  const subs = await db.query<any>(`SELECT endpoint, p256dh, auth FROM push_subscriptions ${where}`, params);
  for (const sub of subs) {
    try {
      await fetch(sub.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", TTL: "60" },
        body: JSON.stringify({
          title: "Folio Tax — " + (body.eventType || "Update"),
          body: body.message,
          url: "/",
          icon: "/icons/icon-192.png",
          data: { eventType: body.eventType, clientId: body.clientId },
        }),
      });
    } catch { /* per-subscription failures are silent */ }
  }
  return c.json({ sent: subs.length, eventType: body.eventType });
});

pushRoutes.get("/vapid-public-key", (c) => {
  const key = c.env.VAPID_PUBLIC_KEY || "";
  return c.json({ publicKey: key || null });
});

pushRoutes.post("/sync-event", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({ clientId: z.string(), eventType: z.string(), data: z.any().optional() }).parse(await c.req.json());
  const { appendSyncEvent, firePushes } = await import("../services/sync");
  await appendSyncEvent(db, firm.id, c.get("userId"), "document", body.clientId, "update", { eventType: body.eventType, ...body.data as any });
  await firePushes(db, c.get("userId"), "Folio Sync", `${body.eventType} updated`);
  return c.json({ sent: 1, eventType: body.eventType });
});

pushRoutes.post("/sync/events", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = z.object({ entity: z.string(), entity_id: z.string(), op: z.enum(["create", "update", "delete"]), payload: z.any().optional() }).parse(await c.req.json());
  const { appendSyncEvent, firePushes } = await import("../services/sync");
  await appendSyncEvent(db, firm.id, c.get("userId"), body.entity as any, body.entity_id, body.op, body.payload as any);
  await firePushes(db, c.get("userId"), "Folio Sync", `${body.op} on ${body.entity}`);
  return c.json({ ok: true });
});

pushRoutes.get("/sync/poll", async (c) => {
  const db = createDb(c.env);
  const since = c.req.query("since") as string | undefined;
  let whereClause = "";
  let params: unknown[] = [];
  if (since) { whereClause = `WHERE ts > $1`; params = [since]; }
  const rows = await db.query<any>(`SELECT id, firm_id, user_id, entity, entity_id, op, payload, ts FROM sync_events ${whereClause} ORDER BY ts DESC LIMIT 50`, params).catch(() => []);
  return c.json({ events: rows });
});