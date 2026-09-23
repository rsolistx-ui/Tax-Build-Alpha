import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { computeEstimatedTax } from "../services/estimated-tax";
import { MileageError, addTrip, listTrips, removeTrip, summarizeTrips } from "../services/mileage";

/** Quarterly estimated-tax worksheet and mileage log, mounted at /api/clients. */
export const taxPlanningRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
taxPlanningRoutes.use("*", requireSession);

async function scope(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) throw new MileageError("Client not found.", 404);
  return { db, firmId: firm.id as string, clientId: client.id as string };
}

function fail(c: any, error: unknown) {
  if (error instanceof MileageError) return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message ?? "Invalid request" }, 400);
  throw error;
}

const money = z.number().min(0).max(100_000_000).nullable().optional();

taxPlanningRoutes.post("/:clientId/estimated-tax", async (c) => {
  try {
    await scope(c);
    const input = z.object({
      taxYear: z.number().int().min(2020).max(2100),
      priorYearTax: money, priorYearAgi: money, currentYearTax: money,
      expectedWithholding: z.number().min(0).optional(),
      priorYearQualifies: z.boolean().optional(), marriedFilingSeparately: z.boolean().optional(), farmerOrFisherman: z.boolean().optional(),
    }).parse(await c.req.json());
    return c.json(computeEstimatedTax(input));
  } catch (error) { return fail(c, error); }
});

taxPlanningRoutes.get("/:clientId/mileage", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const year = Number(c.req.query("year")) || new Date().getUTCFullYear();
    const trips = await listTrips(db, firmId, clientId, year);
    return c.json({ year, trips, summary: summarizeTrips(trips) });
  } catch (error) { return fail(c, error); }
});

taxPlanningRoutes.post("/:clientId/mileage", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const input = z.object({
      tripDate: z.string(), origin: z.string().max(200).nullable().optional(), destination: z.string().max(200),
      businessPurpose: z.string().max(500), miles: z.number(), vehicle: z.string().max(100).nullable().optional(),
      parkingAndTolls: z.number().optional(),
    }).parse(await c.req.json());
    return c.json({ trip: await addTrip(db, firmId, clientId, c.get("userId"), input) }, 201);
  } catch (error) { return fail(c, error); }
});

taxPlanningRoutes.delete("/:clientId/mileage/:tripId", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    await removeTrip(db, firmId, clientId, c.req.param("tripId"));
    return c.json({ ok: true });
  } catch (error) { return fail(c, error); }
});
