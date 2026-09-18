import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import { requireSession, type AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { FeatureRequestsService, type FeatureRequestArea, type FeatureRequestStatus } from "../services/feature-requests";

export const featureRequestRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

featureRequestRoutes.use("*", requireSession);

const createSchema = z.object({
  title: z.string().min(2).max(150),
  description: z.string().min(5),
  area: z.enum(["receipt_scanning", "categorization", "tax_radar", "reports", "bank_feed", "ui_ux", "general"]).optional(),
  clientId: z.string().optional(),
  source: z.enum(["text", "voice"]).optional(),
});

const updateSchema = z.object({
  status: z.enum(["submitted", "under_review", "in_progress", "completed", "declined"]).optional(),
  adminNotes: z.string().optional(),
});

featureRequestRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const service = new FeatureRequestsService(db);
  const status = c.req.query("status") as FeatureRequestStatus | undefined;

  const requests = await service.list(firm.id, status);
  return c.json({ requests });
});

featureRequestRoutes.post("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = createSchema.parse(await c.req.json());
  const service = new FeatureRequestsService(db);

  const request = await service.create(firm.id, c.get("userId"), {
    title: body.title,
    description: body.description,
    area: body.area as FeatureRequestArea | undefined,
    clientId: body.clientId,
    source: body.source,
  });

  return c.json({ request }, 201);
});

featureRequestRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = updateSchema.parse(await c.req.json());
  const service = new FeatureRequestsService(db);

  const updated = await service.update(firm.id, c.req.param("id"), c.get("userId"), {
    status: body.status,
    adminNotes: body.adminNotes,
  });

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json({ request: updated });
});
