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

pushRoutes.get("/vapid-public-key", (c) => {
  const key = c.env.VAPID_PUBLIC_KEY || "";
  return c.json({ publicKey: key || null });
});
