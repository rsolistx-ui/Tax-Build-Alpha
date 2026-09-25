import { Hono } from "hono";
import { isClientVisible } from "../services/client-assignment";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { IntercompanyMirrorService } from "../services/intercompany-mirror";

export const intercompanyRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

/**
 * GET /api/clients/:clientId/intercompany/matches
 * Scans bank transactions across this client and all other entities in the firm
 * to detect matching intercompany mirror transactions.
 */
intercompanyRoutes.get("/:clientId/intercompany/matches", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new IntercompanyMirrorService(db);
  const matches = await service.detectMirrorTransactions(firm.id, clientId);

  return c.json({
    matches,
    clientName: client.name,
    legalName: client.legal_name,
    count: matches.length,
  });
});

/**
 * POST /api/clients/:clientId/intercompany/reconcile
 * 1-Click dual-book reconciliation: Atomically clears and categorizes both sides
 * of the intercompany transaction simultaneously.
 */
intercompanyRoutes.post("/:clientId/intercompany/reconcile", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z
    .object({
      sourceTxnId: z.string().min(1),
      sourceClientId: z.string().min(1),
      sourceClientName: z.string().min(1),
      mirrorTxnId: z.string().min(1),
      mirrorClientId: z.string().min(1),
      mirrorClientName: z.string().min(1),
      amount: z.number().positive(),
      reason: z.string().optional(),
    })
    .parse(await c.req.json());

  // Security check: one of the two sides must be the authorized client in the route parameter
  if (body.sourceClientId !== clientId && body.mirrorClientId !== clientId) {
    return c.json({ error: "Unauthorized client mismatch in mirror reconciliation" }, 403);
  }
  // The other side must be a client the caller can see (client assignment).
  const otherClientId = body.sourceClientId === clientId ? body.mirrorClientId : body.sourceClientId;
  if (!(await isClientVisible(db, c.get("clientScopeUserId"), otherClientId))) {
    return c.json({ error: "The other client is not assigned to you." }, 403);
  }

  const service = new IntercompanyMirrorService(db);
  const result = await service.reconcileMirrorMatch(
    firm.id,
    c.get("userId"),
    c.get("userName") || "Practitioner",
    body
  );

  return c.json({
    ok: true,
    auditId: result.auditId,
    message: `Successfully reconciled mirror transfer of $${body.amount.toFixed(2)} between ${body.sourceClientName} and ${body.mirrorClientName}.`,
  });
});

/**
 * GET /api/clients/:clientId/intercompany/affiliates
 * Lists all defined intercompany affiliate relationships for this client.
 */
intercompanyRoutes.get("/:clientId/intercompany/affiliates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new IntercompanyMirrorService(db);
  const affiliates = await service.listAffiliates(firm.id, clientId);

  return c.json({ affiliates });
});

/**
 * POST /api/clients/:clientId/intercompany/affiliates
 * Links two client entities as affiliated businesses.
 */
intercompanyRoutes.post("/:clientId/intercompany/affiliates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.param("clientId");
  const client = await getClient(db, clientId, firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z
    .object({
      relatedClientId: z.string().min(1),
      relationshipLabel: z.string().min(1),
    })
    .parse(await c.req.json());

  // Validate the related client exists in the same firm
  const relatedClient = await getClient(db, body.relatedClientId, firm.id);
  if (!relatedClient || !(await isClientVisible(db, c.get("clientScopeUserId"), relatedClient.id))) {
    return c.json({ error: "Related affiliate client not found in this firm" }, 404);
  }

  const service = new IntercompanyMirrorService(db);
  const linkId = await service.addAffiliate(
    firm.id,
    clientId,
    body.relatedClientId,
    body.relationshipLabel
  );

  return c.json({ ok: true, linkId });
});
