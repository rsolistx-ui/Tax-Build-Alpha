import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import { verifyDocumentToken } from "../lib/signed-url";
import { computeAccessDecision, type EntitlementRow } from "../services/beta";
import { SIGNED_RECORD_DOCUMENT_SQL } from "../services/firm-roles";

/**
 * Deliberately outside requireSession: the signed token in the path is the
 * credential (short-lived, HMAC'd, one document each), the same trust model
 * as any presigned-URL download link.
 */
export const signedDocumentRoutes = new Hono<{ Bindings: Env }>();

signedDocumentRoutes.get("/:docId/:token", async (c) => {
  const docId = c.req.param("docId");
  const token = c.req.param("token");
  const scope = await verifyDocumentToken(c.env.BETTER_AUTH_SECRET, docId, token);
  if (!scope) return c.json({ error: "Link expired or invalid" }, 403);

  const db = createDb(c.env);
  if (scope === "unsigned") {
    // Minted for a role that may not read signed records: refuse if the document became one.
    const [signed] = await db.query(`SELECT 1 FROM client_documents WHERE id = $1 AND ${SIGNED_RECORD_DOCUMENT_SQL}`, [docId]);
    if (signed) return c.json({ error: "Not found" }, 404);
  }
  const [doc] = await db.query<{ r2_key: string; filename: string; content_type: string | null; entitlement_status: string | null; entitlement_expires_at: string | null }>(
    `SELECT d.r2_key, d.filename, d.content_type,
            be.status AS entitlement_status, be.expires_at AS entitlement_expires_at
     FROM client_documents d
     JOIN clients cl ON cl.id = d.client_id
     JOIN firms f ON f.id = cl.firm_id
     LEFT JOIN beta_entitlements be ON be.user_id = f.owner_user_id
     WHERE d.id = $1`,
    [docId],
  );
  if (!doc) return c.json({ error: "Not found" }, 404);
  const entitlement: EntitlementRow | null = doc.entitlement_status && doc.entitlement_expires_at
    ? { status: doc.entitlement_status as EntitlementRow["status"], expiresAt: doc.entitlement_expires_at }
    : null;
  const decision = computeAccessDecision(entitlement, new Date());
  if (!decision.allowed) {
    return c.json({ error: "Document access is currently unavailable", code: decision.reason }, 403);
  }

  const [version] = await db.query<{ r2_key: string }>(
    `SELECT r2_key FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1`,
    [docId],
  );
  const r2Key = version?.r2_key ?? doc.r2_key;

  const object = await c.env.RECEIPTS.get(r2Key);
  if (!object) return c.json({ error: "Not found" }, 404);

  const filename = doc.filename.replace(/["\r\n\\]/g, "");
  const contentType = doc.content_type || "application/pdf";
  const isSafeInline = contentType.startsWith("application/pdf") || contentType.startsWith("image/");
  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": isSafeInline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
});
