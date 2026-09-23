import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { AGREEMENT_TEXT, acceptAgreement, agreementStatus } from "../services/service-agreement";

/** Truepost service agreement (16 CFR 314.4(f)(2) service-provider contract), mounted at /api/agreement. */
export const agreementRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
agreementRoutes.use("*", requireSession);

agreementRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  return c.json({ ...(await agreementStatus(db, c.get("userId"))), text: AGREEMENT_TEXT });
});

agreementRoutes.post("/accept", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = await c.req.json().catch(() => ({})) as { typedName?: string; agreed?: boolean };
  if (body.agreed !== true) return c.json({ error: "Check the box to accept the agreement." }, 422);
  try {
    return c.json(await acceptAgreement(db, { firmId: firm.id, userId: c.get("userId"), typedName: body.typedName ?? "", ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null }), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not record acceptance." }, 422);
  }
});
