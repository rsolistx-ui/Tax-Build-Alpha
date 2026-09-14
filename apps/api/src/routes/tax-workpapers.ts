import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getTaxWorkpaper, upsertTaxWorkpaper } from "../services/tax-workpapers";

export const taxWorkpaperRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
taxWorkpaperRoutes.use("*", requireSession);
taxWorkpaperRoutes.use("*", requireActiveBeta);

taxWorkpaperRoutes.get("/:clientId/tax-workpaper/:taxYear", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(c.req.param("taxYear"));
  if (!parsed.success) return c.json({ error: "Invalid taxYear" }, 400);
  const wp = await getTaxWorkpaper(db, firm.id, client.id, parsed.data);
  return c.json({ workpaper: wp ?? null });
});

taxWorkpaperRoutes.put("/:clientId/tax-workpaper/:taxYear", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const parsed = z.coerce.number().int().min(2000).max(2100).safeParse(c.req.param("taxYear"));
  if (!parsed.success) return c.json({ error: "Invalid taxYear" }, 400);
  const body = z.object({ data: z.any(), name: z.string().optional() }).parse(await c.req.json());
  const wp = await upsertTaxWorkpaper(db, firm.id, client.id, parsed.data, body.data, body.name);
  return c.json({ workpaper: wp });
});
