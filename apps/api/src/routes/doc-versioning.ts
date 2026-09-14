import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { listVersions, createVersion, listSignatureRequests, createSignatureRequest } from "../services/doc-versioning";

export const docVersioningRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
docVersioningRoutes.use("*", requireSession);
docVersioningRoutes.use("*", requireActiveBeta);

docVersioningRoutes.get("/:clientId/documents/:docId/versions", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json({ versions: await listVersions(db, c.req.param("docId")) });
});
docVersioningRoutes.post("/:clientId/documents/:docId/versions", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ r2Key: z.string() }).parse(await c.req.json());
  return c.json({ version: await createVersion(db, firm.id, c.req.param("docId"), body.r2Key, c.get("userId")) }, 201);
});
docVersioningRoutes.get("/:clientId/signature-requests", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json({ requests: await listSignatureRequests(db, firm.id, client.id) });
});
docVersioningRoutes.post("/:clientId/signature-requests", async (c) => {
  const db = createDb(c.env); const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id); if (!client) return c.json({ error: "Client not found" }, 404);
  const body = z.object({ engagementId: z.string().optional(), documentId: z.string().optional(), formType: z.string().default("8879"), recipients: z.array(z.any()).default([]) }).parse(await c.req.json());
  return c.json({ request: await createSignatureRequest(db, firm.id, client.id, body) }, 201);
});
