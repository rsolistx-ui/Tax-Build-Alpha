import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import * as clients from "../services/clients";
import { ensureFirm } from "../services/firm";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  legal_name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legal_name: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const clientRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

clientRoutes.use("*", requireSession);

clientRoutes.get("/", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const list = await clients.listClients(c.env.DB, firm.id);
  return c.json({ firm, clients: list });
});

clientRoutes.post("/", async (c) => {
  const body = createSchema.parse(await c.req.json());
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const created = await clients.createClient(c.env.DB, firm.id, body);
  return c.json({ client: created }, 201);
});

clientRoutes.get("/:id", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const client = await clients.getClient(c.env.DB, c.req.param("id"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  return c.json({ client });
});

clientRoutes.patch("/:id", async (c) => {
  const body = updateSchema.parse(await c.req.json());
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const updated = await clients.updateClient(c.env.DB, c.req.param("id"), firm.id, body);
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json({ client: updated });
});

clientRoutes.delete("/:id", async (c) => {
  const firm = await ensureFirm(c.env.DB, c.get("userId"), c.get("userName"));
  const ok = await clients.deleteClient(c.env.DB, c.req.param("id"), firm.id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
