import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
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

const profileSchema = z.object({
  entity_type: z.string().max(100).nullable().optional(),
  industry: z.string().max(150).nullable().optional(),
  state: z.string().max(50).nullable().optional(),
  tax_year: z.number().int().min(2000).max(2100).nullable().optional(),
  accounting_basis: z.enum(["cash", "accrual"]).nullable().optional(),
  default_currency: z.string().length(3).optional(),
  profile: z.record(z.unknown()).optional(),
});

export const clientRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
clientRoutes.use("*", requireSession);

clientRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  return c.json({ firm, clients: await clients.listClients(db, firm.id) });
});

clientRoutes.post("/", async (c) => {
  const body = createSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const created = await clients.createClient(db, firm.id, body);
  return c.json({ client: created }, 201);
});

clientRoutes.get("/:id/profile", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await clients.getClient(db, c.req.param("id"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const [profile] = await db.query(
    `SELECT * FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  return c.json({ profile: profile ?? null });
});

clientRoutes.patch("/:id/profile", async (c) => {
  const body = profileSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await clients.getClient(db, c.req.param("id"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const [current] = await db.query<Record<string, unknown>>(
    `SELECT * FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );

  const next = {
    entity_type: body.entity_type !== undefined ? body.entity_type : current?.entity_type ?? null,
    industry: body.industry !== undefined ? body.industry : current?.industry ?? null,
    state: body.state !== undefined ? body.state : current?.state ?? null,
    tax_year: body.tax_year !== undefined ? body.tax_year : current?.tax_year ?? null,
    accounting_basis:
      body.accounting_basis !== undefined ? body.accounting_basis : current?.accounting_basis ?? null,
    default_currency: body.default_currency ?? String(current?.default_currency ?? "USD"),
    profile: body.profile ?? (current?.profile as Record<string, unknown> | undefined) ?? {},
  };

  const [profile] = await db.query(
    `INSERT INTO client_profiles
       (client_id, entity_type, industry, state, tax_year, accounting_basis, default_currency, profile, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
     ON CONFLICT (client_id) DO UPDATE SET
       entity_type = EXCLUDED.entity_type,
       industry = EXCLUDED.industry,
       state = EXCLUDED.state,
       tax_year = EXCLUDED.tax_year,
       accounting_basis = EXCLUDED.accounting_basis,
       default_currency = EXCLUDED.default_currency,
       profile = EXCLUDED.profile,
       updated_at = NOW()
     RETURNING *`,
    [
      client.id,
      next.entity_type,
      next.industry,
      next.state,
      next.tax_year,
      next.accounting_basis,
      next.default_currency,
      next.profile,
    ],
  );
  return c.json({ profile });
});

clientRoutes.get("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await clients.getClient(db, c.req.param("id"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);
  return c.json({ client });
});

clientRoutes.patch("/:id", async (c) => {
  const body = updateSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const updated = await clients.updateClient(db, c.req.param("id"), firm.id, body);
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json({ client: updated });
});

clientRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const ok = await clients.deleteClient(db, c.req.param("id"), firm.id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
