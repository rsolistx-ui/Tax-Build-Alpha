import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { createReturn, submitReturn } from "../services/return-engine";

export const returnEngineRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
returnEngineRoutes.use("*", requireSession);
returnEngineRoutes.use("*", requireActiveBeta);

returnEngineRoutes.post("/:clientId/returns", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ taxYear: z.number().int(), formType: z.string() }).parse(await c.req.json());
  try { return c.json({ return: await createReturn(db, firm.id, client.id, body.taxYear, body.formType) }, 201); } catch (e: any) { return c.json({ error: e.message }, 400); }
});
returnEngineRoutes.post("/:clientId/returns/:returnId/submit", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  try { return c.json({ return: await submitReturn(db, c.req.param("returnId")) }); } catch (e: any) { return c.json({ error: e.message }, 400); }
});
returnEngineRoutes.get("/:clientId/returns", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const rows = await db.query<any>(`SELECT * FROM tax_returns WHERE firm_id=$1 AND client_id=$2 ORDER BY tax_year DESC`, [firm.id, client.id]);
  return c.json({ returns: rows });
});
