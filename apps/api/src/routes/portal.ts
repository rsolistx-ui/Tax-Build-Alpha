import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import { requirePortalToken, type PortalVars } from "../middleware/portal";
import { getClient } from "../services/clients";
import { listEngagements } from "../services/engagements";
import { getClientRequest, listClientRequests, markRequestViewed } from "../services/client-requests";
import { addRequestMessage, listRequestMessages } from "../services/request-messages";

/**
 * Client-facing portal API. Every route resolves firmId/clientId from the
 * portal token via requirePortalToken - never from a path or body
 * parameter the client supplies. A client can only ever see their own
 * engagements, requests, and client-visible documents.
 */
export const portalRoutes = new Hono<{ Bindings: Env; Variables: PortalVars }>();
portalRoutes.use("*", requirePortalToken);

portalRoutes.get("/me", async (c) => {
  const db = createDb(c.env);
  const client = await getClient(db, c.get("portalClientId"), c.get("portalFirmId"));
  if (!client) return c.json({ error: "Not found" }, 404);
  return c.json({ client: { id: client.id, name: client.name } });
});

portalRoutes.get("/engagements", async (c) => {
  const db = createDb(c.env);
  const engagements = await listEngagements(db, c.get("portalFirmId"), c.get("portalClientId"));
  return c.json({ engagements });
});

portalRoutes.get("/requests", async (c) => {
  const db = createDb(c.env);
  const requests = await listClientRequests(db, c.get("portalFirmId"), c.get("portalClientId"));
  // Never show a request still in "draft" - that is pre-professional-approval.
  return c.json({ requests: requests.filter((r) => r.status !== "draft") });
});

async function loadPortalRequest(c: { env: Env; get: (k: keyof PortalVars) => string }, requestId: string) {
  const db = createDb(c.env);
  const request = await getClientRequest(db, requestId, c.get("portalFirmId"));
  if (!request || request.client_id !== c.get("portalClientId") || request.status === "draft") return undefined;
  return request;
}

portalRoutes.get("/requests/:requestId", async (c) => {
  const request = await loadPortalRequest(c, c.req.param("requestId"));
  if (!request) return c.json({ error: "Not found" }, 404);

  const db = createDb(c.env);
  await markRequestViewed(db, request.id, c.get("portalFirmId"));
  const messages = await listRequestMessages(db, request.id);
  return c.json({ request, messages });
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

portalRoutes.post("/requests/:requestId/messages", async (c) => {
  const request = await loadPortalRequest(c, c.req.param("requestId"));
  if (!request) return c.json({ error: "Not found" }, 404);

  const db = createDb(c.env);
  const body = messageSchema.parse(await c.req.json());
  const message = await addRequestMessage(db, request.id, c.get("portalFirmId"), "client", null, body.body);
  return c.json({ message }, 201);
});

portalRoutes.get("/documents", async (c) => {
  const db = createDb(c.env);
  const documents = await db.query(
    `SELECT id, filename, document_type, status, uploaded_at FROM client_documents WHERE client_id = $1 AND client_visible = TRUE ORDER BY uploaded_at DESC`,
    [c.get("portalClientId")],
  );
  return c.json({ documents });
});
