import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import * as clients from "../services/clients";
import { ensureFirm } from "../services/firm";
import { normalizeCurrencyCode } from "../services/pnl";
import { newId } from "../lib/id";
import { validateProfileInput, mergeProfile } from "../services/client-profile";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  legal_name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(40).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legal_name: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
});

const profileSchema = z.object({
  entity_type: z.string().max(100).nullable().optional(),
  industry: z.string().max(150).nullable().optional(),
  state: z.string().max(50).nullable().optional(),
  tax_year: z.number().int().min(2000).max(2100).nullable().optional(),
  accounting_basis: z.enum(["cash", "accrual"]).nullable().optional(),
  default_currency: z
    .string()
    .transform((value, ctx) => {
      const normalized = normalizeCurrencyCode(value);
      if (normalized === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "default_currency must be exactly three alphabetic characters" });
        return z.NEVER;
      }
      return normalized;
    })
    .optional(),
  profile: z.record(z.unknown()).optional(),
});

export const clientRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

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
  if (created) {
    await db.query(
      "INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1, $2, $3, 'client_created', $4::jsonb)",
      [newId("aud"), created.id, c.get("userId"), { name: created.name }],
    );
    try {
      const { appendSyncEvent, firePushes } = await import("../services/sync");
      await appendSyncEvent(db, firm.id, c.get("userId"), "client", created.id, "create", { name: created.name });
      await firePushes(db, c.get("userId"), "Client created", created.name);
    } catch {}
  }
  return c.json({ client: created }, 201);
});

clientRoutes.get("/:id/profile", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await clients.getClient(db, c.req.param("id"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const [profile] = await db.query<Record<string, unknown>>(
    `SELECT * FROM client_profiles WHERE client_id = $1`,
    [client.id],
  );
  const normalized = profile
    ? { ...profile, default_currency: String(profile.default_currency ?? "USD").toUpperCase() }
    : null;
  return c.json({ profile: normalized });
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

  let mergedProfileFields = (current?.profile as Record<string, unknown> | undefined) ?? {};
  if (body.profile) {
    const validation = validateProfileInput(body.profile);
    if (!validation.ok) return c.json({ error: validation.error }, 400);
    mergedProfileFields = mergeProfile(mergedProfileFields, validation.sanitized);
  }

  const next = {
    entity_type: body.entity_type !== undefined ? body.entity_type : current?.entity_type ?? null,
    industry: body.industry !== undefined ? body.industry : current?.industry ?? null,
    state: body.state !== undefined ? body.state : current?.state ?? null,
    tax_year: body.tax_year !== undefined ? body.tax_year : current?.tax_year ?? null,
    accounting_basis:
      body.accounting_basis !== undefined ? body.accounting_basis : current?.accounting_basis ?? null,
    default_currency: (body.default_currency ?? String(current?.default_currency ?? "USD")).toUpperCase(),
    profile: mergedProfileFields,
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
  await db.query(
    "INSERT INTO audit_events (id, client_id, actor_user_id, action, before_json, after_json) VALUES ($1, $2, $3, 'client_profile_updated', $4, $5)",
    [newId("aud"), client.id, c.get("userId"), current ?? null, next],
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

const pipelineStatusSchema = z.object({
  pipelineStatus: z.enum(["prospect", "engaged", "active", "inactive"]),
});

clientRoutes.patch("/:id/pipeline-status", async (c) => {
  const body = pipelineStatusSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const updated = await clients.updateClientPipelineStatus(db, c.req.param("id"), firm.id, body.pipelineStatus);
  if (!updated) return c.json({ error: "Not found" }, 404);

  await db.query(
    "INSERT INTO audit_events (id, client_id, actor_user_id, action, after_json) VALUES ($1, $2, $3, 'client_pipeline_status_changed', $4::jsonb)",
    [newId("aud"), updated.id, c.get("userId"), { pipelineStatus: body.pipelineStatus }],
  );

  return c.json({ client: updated });
});

clientRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const ok = await clients.deleteClient(db, c.req.param("id"), firm.id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
