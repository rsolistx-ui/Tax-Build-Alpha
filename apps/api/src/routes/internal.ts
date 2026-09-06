import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";

export const internalRoutes = new Hono<{ Bindings: Env }>();

const SMOKE_FIRM_NAME = "Folio Smoke Test's Firm";

function requireInternalToken(c: { req: { header: (name: string) => string | undefined }; env: Env }) {
  const provided = c.req.header("x-internal-token");
  const expected = c.env.SMOKE_CLEANUP_TOKEN;
  return Boolean(expected) && provided === expected;
}

const cleanupSchema = z.object({ firmId: z.string().min(1) });

/**
 * Deletes exactly one synthetic smoke-test tenant: its Neon firm (which
 * cascades to every client-scoped row via existing foreign keys), the R2
 * receipt objects that cascade cannot reach, and the Better Auth D1 user
 * that owns it. Hard-refuses to run against anything whose firm name does
 * not match the literal name the smoke harness itself creates, so this
 * endpoint can never be used to delete real customer data even by an
 * attacker holding the shared token. Not reachable without the token, not
 * exposed in any UI, and never documented as a public API.
 */
internalRoutes.post("/smoke-cleanup", async (c) => {
  if (!requireInternalToken(c)) return c.json({ error: "Not found" }, 404);
  const body = cleanupSchema.parse(await c.req.json());
  const db = createDb(c.env);

  const [firm] = await db.query<{ id: string; name: string; owner_user_id: string }>(
    `SELECT id, name, owner_user_id FROM firms WHERE id = $1`,
    [body.firmId],
  );
  if (!firm) return c.json({ error: "Not found", removed: false }, 404);
  if (firm.name !== SMOKE_FIRM_NAME) {
    return c.json({ error: "Refusing to clean up a firm that does not match the smoke-test naming convention." }, 400);
  }

  const clientRows = await db.query<{ id: string }>(`SELECT id FROM clients WHERE firm_id = $1`, [firm.id]);
  const clientIds = clientRows.map((r) => r.id);
  const r2Keys = clientIds.length
    ? (await db.query<{ r2_key: string }>(
        `SELECT r2_key FROM receipts WHERE client_id = ANY($1::text[])`,
        [clientIds],
      )).map((r) => r.r2_key)
    : [];

  await db.query(`DELETE FROM firms WHERE id = $1`, [firm.id]);

  const r2Failures: string[] = [];
  for (const key of r2Keys) {
    try {
      await c.env.RECEIPTS.delete(key);
    } catch {
      r2Failures.push(key);
    }
  }

  const authFailures: string[] = [];
  try {
    await c.env.AUTH_DB.prepare(`DELETE FROM session WHERE userId = ?`).bind(firm.owner_user_id).run();
    await c.env.AUTH_DB.prepare(`DELETE FROM account WHERE userId = ?`).bind(firm.owner_user_id).run();
    await c.env.AUTH_DB.prepare(`DELETE FROM user WHERE id = ?`).bind(firm.owner_user_id).run();
  } catch (error) {
    authFailures.push(error instanceof Error ? error.message : "unknown D1 error");
  }

  if (r2Failures.length > 0 || authFailures.length > 0) {
    return c.json(
      { removed: true, firmId: firm.id, clientCount: clientIds.length, r2ObjectsRemoved: r2Keys.length - r2Failures.length, r2Failures, authFailures },
      207,
    );
  }

  return c.json({
    removed: true,
    firmId: firm.id,
    clientCount: clientIds.length,
    r2ObjectsRemoved: r2Keys.length,
  });
});
