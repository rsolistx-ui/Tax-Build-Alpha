import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../env";
import { verifyDocumentToken } from "../lib/signed-url";

/**
 * Deliberately outside requireSession: the signed token in the path is the
 * credential (short-lived, HMAC'd, one document each), the same trust model
 * as any presigned-URL download link.
 */
export const signedDocumentRoutes = new Hono<{ Bindings: Env }>();

signedDocumentRoutes.get("/:docId/:token", async (c) => {
  const docId = c.req.param("docId");
  const token = c.req.param("token");
  const valid = await verifyDocumentToken(c.env.BETTER_AUTH_SECRET, docId, token);
  if (!valid) return c.json({ error: "Link expired or invalid" }, 403);

  const db = createDb(c.env);
  const [doc] = await db.query<{ r2_key: string; filename: string; content_type: string | null }>(
    `SELECT r2_key, filename, content_type FROM client_documents WHERE id=$1`,
    [docId],
  );
  if (!doc) return c.json({ error: "Not found" }, 404);

  const [version] = await db.query<{ r2_key: string }>(
    `SELECT r2_key FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1`,
    [docId],
  );
  const r2Key = version?.r2_key ?? doc.r2_key;

  const object = await c.env.RECEIPTS.get(r2Key);
  if (!object) return c.json({ error: "Not found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": doc.content_type || "application/pdf",
      "Content-Disposition": `inline; filename="${doc.filename}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
});
