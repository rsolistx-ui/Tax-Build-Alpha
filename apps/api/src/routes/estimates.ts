import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getEngagement } from "../services/engagements";
import { EstimatesService, type CreateEstimateInput, type UpdateEstimateInput } from "../services/estimates";
import { newId } from "../lib/id";

export const estimatesRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
estimatesRoutes.use("*", requireSession);
estimatesRoutes.use("*", requireActiveBeta);

const lineSchema = z.object({
  accountId: z.string().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().min(0),
});

const createEstimateSchema = z.object({
  engagementId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(lineSchema).min(1),
  terms: z.string().max(2000).optional(),
  notes: z.string().max(500).optional(),
});

const updateEstimateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired']).optional(),
  terms: z.string().max(2000).optional(),
  notes: z.string().max(500).optional(),
});

const acceptSchema = z.object({
  token: z.string().min(1),
});

// Create estimate
estimatesRoutes.post("/:clientId/estimates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = createEstimateSchema.parse(await c.req.json());

  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement || engagement.client_id !== client.id) {
      return c.json({ error: "Engagement not found for this client" }, 404);
    }
  }

  const service = new EstimatesService(db);
  const estimate = await service.createEstimate(firm.id, {
    clientId: client.id,
    engagementId: body.engagementId ?? null,
    title: body.title,
    description: body.description,
    issueDate: body.issueDate,
    expiryDate: body.expiryDate ?? body.issueDate,
    lines: body.lines.map(l => ({ ...l, accountId: l.accountId ?? null })),
    notes: body.notes,
    terms: body.terms,
  });

  return c.json({ estimate }, 201);
});

// List estimates for a client
estimatesRoutes.get("/:clientId/estimates", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new EstimatesService(db);
  const estimates = await service.getEstimatesByClient(client.id);

  return c.json({ estimates });
});

// Get single estimate with lines
estimatesRoutes.get("/:clientId/estimates/:estimateId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new EstimatesService(db);
  const estimate = await service.getEstimateWithLines(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }

  return c.json({ estimate });
});

// Update estimate (draft only)
estimatesRoutes.patch("/:clientId/estimates/:estimateId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = updateEstimateSchema.parse(await c.req.json());

  const service = new EstimatesService(db);
  const estimate = await service.getEstimate(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }
  if (estimate.status !== 'draft') {
    return c.json({ error: "Only draft estimates can be updated" }, 409);
  }

  const updated = await service.updateEstimate(estimate.id, body);
  return c.json({ estimate: updated });
});

// Send estimate (draft -> sent)
estimatesRoutes.post("/:clientId/estimates/:estimateId/send", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  if (!client.email) {
    return c.json({ error: "Client has no email on file" }, 400);
  }

  const service = new EstimatesService(db);
  const estimate = await service.getEstimate(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }
  if (estimate.status !== 'draft') {
    return c.json({ error: "Only draft estimates can be sent" }, 409);
  }

  const sent = await service.sendEstimate(estimate.id);
  if (!sent) return c.json({ error: "Failed to send estimate" }, 409);

  // Create acceptance token
  const token = await new (await import("../services/estimates")).EstimatesService(db).createAcceptanceToken(estimate.id);

  // In a real implementation, send email with acceptance link
  // For now, just return the token
  return c.json({ estimate: sent, acceptanceToken: token });
});

// View estimate (marks as viewed)
estimatesRoutes.post("/:clientId/estimates/:estimateId/view", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new EstimatesService(db);
  const estimate = await service.getEstimate(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }

  const viewed = await service.viewEstimate(estimate.id);
  return c.json({ estimate: viewed });
});

// Accept estimate (client action via token)
estimatesRoutes.post("/:clientId/estimates/:estimateId/accept", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = acceptSchema.parse(await c.req.json());

  const service = new EstimatesService(db);
  const result = await service.acceptEstimate(body.token);
  if (!result) return c.json({ error: "Invalid or expired acceptance token" }, 404);

  return c.json({ estimate: result.estimate, invoice: result.invoice });
});

// Decline estimate
estimatesRoutes.post("/:clientId/estimates/:estimateId/decline", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new EstimatesService(db);
  const estimate = await service.getEstimate(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }
  if (estimate.status === 'accepted' || estimate.status === 'converted') {
    return c.json({ error: "Cannot decline accepted or converted estimate" }, 409);
  }

  const declined = await new EstimatesService(db).updateEstimate(estimate.id, { status: 'declined' });
  return c.json({ estimate: declined });
});

// Convert estimate to invoice manually
estimatesRoutes.post("/:clientId/estimates/:estimateId/convert", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new EstimatesService(db);
  const estimate = await service.getEstimate(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }
  if (estimate.status !== 'accepted' && estimate.status !== 'sent' && estimate.status !== 'viewed') {
    return c.json({ error: "Only accepted, sent, or viewed estimates can be converted" }, 409);
  }

  const token = (await db.query<any>(`SELECT token FROM estimate_acceptance_tokens WHERE estimate_id = $1`, [estimate.id]))[0]?.token || '';
  if (!token) return c.json({ error: "No acceptance token found" }, 400);

  const result = await new (await import("../services/estimates")).EstimatesService(db).acceptEstimate(token);
  if (!result) return c.json({ error: "Failed to accept estimate" }, 400);

  return c.json({ estimate: result.estimate, invoice: result.invoice });
});

// Delete estimate (draft only)
estimatesRoutes.delete("/:clientId/estimates/:estimateId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new EstimatesService(db);
  const estimate = await service.getEstimate(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }
  if (estimate.status !== 'draft') {
    return c.json({ error: "Only draft estimates can be deleted" }, 409);
  }

  await service.deleteEstimate(estimate.id);
  return c.json({ ok: true });
});

// Generate acceptance token
estimatesRoutes.post("/:clientId/estimates/:estimateId/token", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new EstimatesService(db);
  const estimate = await new (await import("../services/estimates")).EstimatesService(db).getEstimate(c.req.param("estimateId"));
  if (!estimate || estimate.clientId !== client.id) {
    return c.json({ error: "Estimate not found" }, 404);
  }

  const token = await new (await import("../services/estimates")).EstimatesService(db).createAcceptanceToken(estimate.id);
  return c.json({ token });
});