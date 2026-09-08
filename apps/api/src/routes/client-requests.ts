import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import {
  approveDraftRequest,
  cancelRequest,
  createClientRequest,
  getClientRequest,
  listClientRequests,
  satisfyRequest,
} from "../services/client-requests";
import { addRequestMessage, listRequestMessages } from "../services/request-messages";
import { prepareMissingReceiptRequest, prepareTransactionExplanationRequest } from "../services/exception-automation";
import { createPortalLink, revokePortalLink } from "../services/portal";
import { isoTimestampSchema } from "../services/date-validation";

export const clientRequestRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
clientRequestRoutes.use("*", requireSession);
clientRequestRoutes.use("*", requireActiveBeta);

const REQUEST_TYPES = [
  "missing_receipt", "transaction_explanation", "bank_statement", "w2", "1099", "k1",
  "prior_year_return", "organizer_question", "signature_placeholder", "tax_document", "custom",
] as const;

const createSchema = z.object({
  requestType: z.enum(REQUEST_TYPES),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  dueAt: isoTimestampSchema.nullable().optional(),
});

clientRequestRoutes.get("/:clientId/requests", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const requests = await listClientRequests(db, firm.id, client.id);
  return c.json({ requests });
});

clientRequestRoutes.post("/:clientId/requests", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = createSchema.parse(await c.req.json());
  const request = await createClientRequest(db, c.get("userId"), {
    firmId: firm.id,
    clientId: client.id,
    requestType: body.requestType,
    title: body.title,
    description: body.description,
    dueAt: body.dueAt,
    status: "requested",
  });
  return c.json({ request }, 201);
});

async function loadOwnedRequest(db: ReturnType<typeof createDb>, requestId: string, clientId: string, firmId: string) {
  const request = await getClientRequest(db, requestId, firmId);
  if (!request || request.client_id !== clientId) return undefined;
  return request;
}

clientRequestRoutes.post("/:clientId/requests/:requestId/approve", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const existing = await loadOwnedRequest(db, c.req.param("requestId"), client.id, firm.id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const request = await approveDraftRequest(db, existing.id, firm.id, c.get("userId"));
  return c.json({ request });
});

clientRequestRoutes.post("/:clientId/requests/:requestId/satisfy", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const existing = await loadOwnedRequest(db, c.req.param("requestId"), client.id, firm.id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const request = await satisfyRequest(db, existing.id, firm.id, c.get("userId"));
  return c.json({ request });
});

clientRequestRoutes.post("/:clientId/requests/:requestId/cancel", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const existing = await loadOwnedRequest(db, c.req.param("requestId"), client.id, firm.id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const request = await cancelRequest(db, existing.id, firm.id, c.get("userId"));
  return c.json({ request });
});

clientRequestRoutes.get("/:clientId/requests/:requestId/messages", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const existing = await loadOwnedRequest(db, c.req.param("requestId"), client.id, firm.id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const messages = await listRequestMessages(db, existing.id);
  return c.json({ messages });
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

clientRequestRoutes.post("/:clientId/requests/:requestId/messages", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const existing = await loadOwnedRequest(db, c.req.param("requestId"), client.id, firm.id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = messageSchema.parse(await c.req.json());
  const message = await addRequestMessage(db, existing.id, firm.id, client.id, "professional", c.get("userId"), body.body);
  return c.json({ message }, 201);
});

const bankExceptionSchema = z.object({ bankTransactionId: z.string().min(1) });

clientRequestRoutes.post("/:clientId/requests/prepare-missing-receipt", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = bankExceptionSchema.parse(await c.req.json());
  const [txn] = await db.query<{
    id: string; client_id: string; txn_date: string | null; description: string | null; amount: string | null;
  }>(`SELECT id, client_id, txn_date, description, amount FROM bank_transactions WHERE id = $1 AND client_id = $2`, [
    body.bankTransactionId, client.id,
  ]);
  if (!txn) return c.json({ error: "Not found" }, 404);

  const request = await prepareMissingReceiptRequest(db, firm.id, c.get("userId"), {
    id: txn.id, client_id: txn.client_id, txn_date: txn.txn_date, description: txn.description,
    amount: txn.amount, triage: null, pending_receipt_id: null,
  });
  return c.json({ request }, 201);
});

clientRequestRoutes.post("/:clientId/requests/prepare-explanation", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = bankExceptionSchema.parse(await c.req.json());
  const [txn] = await db.query<{
    id: string; client_id: string; txn_date: string | null; description: string | null; amount: string | null;
  }>(`SELECT id, client_id, txn_date, description, amount FROM bank_transactions WHERE id = $1 AND client_id = $2`, [
    body.bankTransactionId, client.id,
  ]);
  if (!txn) return c.json({ error: "Not found" }, 404);

  const request = await prepareTransactionExplanationRequest(db, firm.id, c.get("userId"), {
    id: txn.id, client_id: txn.client_id, txn_date: txn.txn_date, description: txn.description,
    amount: txn.amount, triage: null, pending_receipt_id: null,
  });
  return c.json({ request }, 201);
});

const portalLinkSchema = z.object({ ttlDays: z.number().int().min(1).max(365).optional() });

clientRequestRoutes.post("/:clientId/portal-links", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = portalLinkSchema.parse(await c.req.json().catch(() => ({})));
  const link = await createPortalLink(db, firm.id, client.id, c.get("userId"), body.ttlDays);
  return c.json({ link }, 201);
});

clientRequestRoutes.post("/:clientId/portal-links/:linkId/revoke", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Not found" }, 404);

  const revoked = await revokePortalLink(db, c.req.param("linkId"), firm.id, c.get("userId"));
  return c.json({ revoked });
});
