import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { createReturn, voidReturn } from "../services/return-engine";

export const returnEngineRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

returnEngineRoutes.post("/:clientId/returns", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ taxYear: z.number().int(), formType: z.string().min(1) }).parse(await c.req.json());
  try {
    const ret = await createReturn(db, firm.id, client.id, body.taxYear, body.formType, c.get("userId")) as any;
    try { const { appendSyncEvent, firePushes } = await import("../services/sync"); await appendSyncEvent(db, firm.id, c.get("userId"), "tax_return", ret?.id ?? client.id, "create", { taxYear: body.taxYear, formType: body.formType }); await firePushes(db, c.get("userId"), "Tax return created", `${body.formType} ${body.taxYear}`); } catch {}
    return c.json({ return: ret }, 201);
  } catch (e: any) { return c.json({ error: e.message }, 400); }
});
returnEngineRoutes.post("/:clientId/returns/:returnId/void", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ reason: z.string().default("Voided by firm") }).parse(await c.req.json().catch(() => ({ reason: "Voided by firm" } as any)));
  try { return c.json({ return: await voidReturn(db, firm.id, client.id, c.req.param("returnId"), body.reason) }); } catch (e: any) { return c.json({ error: e.message }, 400); }
});
returnEngineRoutes.get("/:clientId/returns", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const rows = await db.query<any>(`SELECT * FROM tax_returns WHERE firm_id=$1 AND client_id=$2 ORDER BY tax_year DESC, created_at DESC`, [firm.id, client.id]);
  const events = await db.query<any>(`SELECT envelope_id, event, envelope_status, payload FROM docusign_webhook_events WHERE envelope_id IN (SELECT id::text FROM tax_returns WHERE firm_id=$1 AND client_id=$2) ORDER BY created_at ASC`, [firm.id, client.id]);
  const eventsByReturn = new Map<string, any[]>();
  for (const ev of events) { const k = ev.envelope_id; if (!eventsByReturn.has(k)) eventsByReturn.set(k, []); eventsByReturn.get(k)!.push(ev); }
  return c.json({ returns: rows.map((r: any) => ({ ...r, events: eventsByReturn.get(r.id) ?? [] })) });
});
