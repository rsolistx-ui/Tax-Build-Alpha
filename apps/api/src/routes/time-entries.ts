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
import {
  TimeTrackingService,
  TimeEntryConflictError,
  TimeEntryInvoicedError,
  TimeEntryMissingRateError,
} from "../services/time-tracking";
import { newId } from "../lib/id";

export const timeEntryRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
timeEntryRoutes.use("*", requireSession);
timeEntryRoutes.use("*", requireActiveBeta);

const startTimerSchema = z.object({
  engagementId: z.string().optional(),
  billingRateId: z.string().optional(),
  description: z.string().min(1).max(500),
  isBillable: z.boolean().optional(),
});

const manualEntrySchema = z.object({
  engagementId: z.string().optional(),
  billingRateId: z.string().optional(),
  description: z.string().min(1).max(500),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  isBillable: z.boolean().optional(),
});

const updateEntrySchema = z.object({
  description: z.string().min(1).max(500).optional(),
  engagementId: z.string().nullable().optional(),
  billingRateId: z.string().nullable().optional(),
  isBillable: z.boolean().optional(),
});

const convertSchema = z.object({
  entryIds: z.array(z.string()).min(1),
  engagementId: z.string().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).optional(),
});

async function resolveClient(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  return { db, firm, client };
}

// Start a timer for a client (one running timer per client at a time)
timeEntryRoutes.post("/:clientId/timer/start", async (c) => {
  const { db, firm, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = startTimerSchema.parse(await c.req.json());
  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement || engagement.client_id !== client.id) {
      return c.json({ error: "Engagement not found for this client" }, 404);
    }
  }

  const service = new TimeTrackingService(db);
  try {
    const entry = await service.startTimer(firm.id, client.id, body, c.get("userId"));
    return c.json({ entry }, 201);
  } catch (err) {
    if (err instanceof TimeEntryConflictError) return c.json({ error: err.message }, 409);
    throw err;
  }
});

// Currently running timer for a client, if any
timeEntryRoutes.get("/:clientId/timer/running", async (c) => {
  const { db, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new TimeTrackingService(db);
  const entry = await service.getRunningTimer(client.id);
  return c.json({ entry });
});

// Stop a running timer
timeEntryRoutes.post("/:clientId/timer/:entryId/stop", async (c) => {
  const { db, firm, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new TimeTrackingService(db);
  const existing = await service.getEntry(c.req.param("entryId"));
  if (!existing || existing.clientId !== client.id) return c.json({ error: "Time entry not found" }, 404);

  const entry = await service.stopTimer(existing.id);

  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
     VALUES ($1,$2,$3,'time_entry_stopped',$4,$5::jsonb,NOW())`,
    [newId("aud"), firm.id, client.id, c.get("userId"), JSON.stringify({ entryId: existing.id, durationMinutes: entry?.durationMinutes ?? null })],
  );

  return c.json({ entry });
});

// Log a manual (non-timer) time entry
timeEntryRoutes.post("/:clientId/entries", async (c) => {
  const { db, firm, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = manualEntrySchema.parse(await c.req.json());
  if (new Date(body.endedAt) < new Date(body.startedAt)) {
    return c.json({ error: "endedAt must not be before startedAt" }, 400);
  }
  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement || engagement.client_id !== client.id) {
      return c.json({ error: "Engagement not found for this client" }, 404);
    }
  }

  const service = new TimeTrackingService(db);
  const entry = await service.logManualEntry(firm.id, client.id, body, c.get("userId"));
  return c.json({ entry }, 201);
});

// List time entries for a client (?unbilled=1 for invoice-ready entries only)
timeEntryRoutes.get("/:clientId/entries", async (c) => {
  const { db, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new TimeTrackingService(db);
  const entries = await service.listByClient(client.id, { unbilledOnly: c.req.query("unbilled") === "1" });
  return c.json({ entries });
});

// Edit an unbilled entry
timeEntryRoutes.patch("/:clientId/entries/:entryId", async (c) => {
  const { db, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new TimeTrackingService(db);
  const existing = await service.getEntry(c.req.param("entryId"));
  if (!existing || existing.clientId !== client.id) return c.json({ error: "Time entry not found" }, 404);

  const body = updateEntrySchema.parse(await c.req.json());
  try {
    const entry = await service.updateEntry(existing.id, body);
    return c.json({ entry });
  } catch (err) {
    if (err instanceof TimeEntryInvoicedError) return c.json({ error: err.message }, 409);
    throw err;
  }
});

// Delete an unbilled entry
timeEntryRoutes.delete("/:clientId/entries/:entryId", async (c) => {
  const { db, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new TimeTrackingService(db);
  const existing = await service.getEntry(c.req.param("entryId"));
  if (!existing || existing.clientId !== client.id) return c.json({ error: "Time entry not found" }, 404);

  try {
    await service.deleteEntry(existing.id);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof TimeEntryInvoicedError) return c.json({ error: err.message }, 409);
    throw err;
  }
});

// Convert selected unbilled entries into one draft invoice
timeEntryRoutes.post("/:clientId/entries/convert-to-invoice", async (c) => {
  const { db, firm, client } = await resolveClient(c);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = convertSchema.parse(await c.req.json());
  const service = new TimeTrackingService(db);

  try {
    const invoice = await service.convertToInvoice(firm.id, client.id, body.entryIds, {
      engagementId: body.engagementId,
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      notes: body.notes,
    });

    await db.query(
      `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
       VALUES ($1,$2,$3,'time_entries_invoiced',$4,$5::jsonb,NOW())`,
      [newId("aud"), firm.id, client.id, c.get("userId"), JSON.stringify({ invoiceId: invoice.id, entryIds: body.entryIds })],
    );

    return c.json({ invoice }, 201);
  } catch (err) {
    if (err instanceof TimeEntryMissingRateError) {
      return c.json({ error: err.message, entryIds: err.entryIds }, 422);
    }
    if (err instanceof TimeEntryInvoicedError) return c.json({ error: err.message }, 409);
    throw err;
  }
});
