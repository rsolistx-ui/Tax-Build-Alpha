import { Hono } from "hono";
import { z } from "zod";
import { handleReminderCron } from "../services/reminders";
import { createDb } from "../db";
import type { Env } from "../env";

export const internalRoutes = new Hono<{ Bindings: Env }>();

// Firm names this endpoint is permitted to delete. Both the smoke harness's
// own firm name and the exact names left behind by earlier manual
// development reproduction sessions are listed explicitly; nothing else
// ever qualifies, so this endpoint can never be used to delete a real
// customer's data even by an attacker holding the shared token.
const ALLOWED_CLEANUP_FIRM_NAMES = new Set([
  "Folio Smoke Test's Firm",
  "Repro's Firm",
  "Repro2's Firm",
]);

function requireInternalToken(c: { req: { header: (name: string) => string | undefined }; env: Env }) {
  const provided = c.req.header("x-internal-token");
  const expected = c.env.SMOKE_CLEANUP_TOKEN;
  return Boolean(expected) && provided === expected;
}

const cleanupSchema = z.object({ firmId: z.string().min(1) });

/**
 * Deletes exactly one synthetic tenant: its Neon firm (which cascades to
 * every client-scoped row via existing foreign keys), the R2 receipt
 * objects that cascade cannot reach, every beta security row created for
 * its owner (invitation, entitlement, access-event history), and the
 * Better Auth D1 user that owns it. Hard-refuses to run against anything
 * whose firm name is not in the explicit allowlist above. Not reachable
 * without the token, not exposed in any UI, and never documented as a
 * public API.
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
  if (!ALLOWED_CLEANUP_FIRM_NAMES.has(firm.name)) {
    return c.json({ error: "Refusing to clean up a firm that does not match an allowed cleanup naming convention." }, 400);
  }

  const clientRows = await db.query<{ id: string }>(`SELECT id FROM clients WHERE firm_id = $1`, [firm.id]);
  const clientIds = clientRows.map((r) => r.id);
  // The Db wrapper JSON-stringifies any object/array parameter, so a JS
  // array parameter arrives as jsonb text rather than a Postgres array
  // literal; unnest it as jsonb instead of casting to text[].
  const r2Keys = clientIds.length
    ? (await db.query<{ r2_key: string }>(
        `SELECT r2_key FROM receipts WHERE client_id IN (SELECT jsonb_array_elements_text($1::jsonb))`,
        [clientIds],
      )).map((r) => r.r2_key)
    : [];

  await db.query(`DELETE FROM firms WHERE id = $1`, [firm.id]);

  const betaMetadataFailures: string[] = [];
  try {
    await db.query(
      `DELETE FROM beta_access_events WHERE affected_user_id = $1 OR actor_user_id = $1`,
      [firm.owner_user_id],
    );
    await db.query(`DELETE FROM beta_entitlements WHERE user_id = $1`, [firm.owner_user_id]);
    await db.query(`DELETE FROM beta_invitations WHERE redeemed_by_user_id = $1`, [firm.owner_user_id]);
  } catch (error) {
    betaMetadataFailures.push(error instanceof Error ? error.message : "unknown Neon error");
  }

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

  if (r2Failures.length > 0 || authFailures.length > 0 || betaMetadataFailures.length > 0) {
    return c.json(
      {
        removed: true,
        firmId: firm.id,
        clientCount: clientIds.length,
        r2ObjectsRemoved: r2Keys.length - r2Failures.length,
        r2Failures,
        authFailures,
        betaMetadataFailures,
      },
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

/**
 * Daily reminder cron: runs at 09:00 UTC (configured in wrangler.toml).
 * Scans every firm for client_requests in 'requested' or 'viewed' status
 * whose next_reminder_at has arrived, posts a system reminder message,
 * and exponentially backs off the next reminder (5d → 10d → 20d → 40d, capped at 30d).
 */
internalRoutes.get("/reminders", async (c) => {
  if (!requireInternalToken(c)) return c.json({ error: "Not found" }, 404);
  const result = await handleReminderCron(c.env);
  return c.json(result);
});
