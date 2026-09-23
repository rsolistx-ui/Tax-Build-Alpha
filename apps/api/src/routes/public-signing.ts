import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import { NativeEsignService } from "../services/native-esign";
import { isIrsEfileAuthorization } from "../services/tax-signature-policy";
import { claimSigningAccess, consumeSigningAccess, releaseSigningAccess, resolveSigningAccess } from "../services/signature-access";
import { computeAccessDecision, type EntitlementRow } from "../services/beta";

type SigningVars = { signingToken: string };
export const publicSigningRoutes = new Hono<{ Bindings: Env; Variables: SigningVars }>();

function token(c: { req: { header(name: string): string | undefined } }): string | null {
  const value = c.req.header("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}
async function access(c: any) {
  const presented = token(c); if (!presented || presented.length < 32) return null;
  const db = createDb(c.env);
  const link = await resolveSigningAccess(db, presented); if (!link) return null;
  // A client-facing signing link is an operational service, so it stops with
  // the firm entitlement instead of remaining usable after the trial expires.
  const [row] = await db.query<{ status: string | null; expires_at: string | null }>(
    `SELECT be.status, be.expires_at FROM firms f LEFT JOIN beta_entitlements be ON be.user_id=f.owner_user_id WHERE f.id=$1`, [link.firmId],
  );
  const entitlement: EntitlementRow | null = row?.status && row.expires_at ? { status: row.status as EntitlementRow["status"], expiresAt: row.expires_at } : null;
  return computeAccessDecision(entitlement, new Date()).allowed ? link : null;
}
export const resolvePublicSigningLink = access;
function invalid(c: any) { return c.json({ error: "This signing link is unavailable. Ask your firm for a new link." }, 401); }

publicSigningRoutes.get("/me", async (c) => {
  const link = await access(c); if (!link || isIrsEfileAuthorization(link.formType)) return invalid(c);
  return c.json({ document: { title: link.filename, formType: link.formType || "document", expiresAt: link.expiresAt }, signer: { name: link.recipientName, email: link.recipientEmail } });
});

publicSigningRoutes.get("/document", async (c) => {
  const link = await access(c); if (!link || isIrsEfileAuthorization(link.formType)) return invalid(c);
  const db = createDb(c.env);
  const [version] = await db.query<any>(`SELECT r2_key FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1`, [link.documentId]);
  const [doc] = version ? [null] : await db.query<any>(`SELECT r2_key FROM client_documents WHERE id=$1 AND client_id=$2`, [link.documentId, link.clientId]);
  const key = version?.r2_key || doc?.r2_key; const object = key ? await c.env.RECEIPTS.get(key) : null;
  if (!object) return c.json({ error: "Document is no longer available." }, 404);
  return new Response(object.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${link.filename.replace(/[\r\n"]/g, "")}"`, "Cache-Control": "no-store" } });
});

const submission = z.object({ signatureType: z.enum(["drawn", "typed"]), signatureData: z.string().min(1), signerName: z.string().trim().min(1), consentAgreed: z.literal(true) });
publicSigningRoutes.post("/complete", async (c) => {
  const link = await access(c); if (!link || isIrsEfileAuthorization(link.formType)) return invalid(c);
  const body = submission.parse(await c.req.json()); const db = createDb(c.env);
  if (!(await claimSigningAccess(db, link.linkId))) return c.json({ error: "This signing link was just used or is no longer available." }, 409);
  try {
    const [version] = await db.query<any>(`SELECT r2_key FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1`, [link.documentId]);
    const [doc] = version ? [null] : await db.query<any>(`SELECT r2_key FROM client_documents WHERE id=$1 AND client_id=$2`, [link.documentId, link.clientId]);
    const key = version?.r2_key || doc?.r2_key; const object = key ? await c.env.RECEIPTS.get(key) : null;
    if (!object) throw new Error("Document is no longer available.");
    const result = await new NativeEsignService(db, c.env).stampAndCertifyDocument(link.firmId, link.clientId, link.requestId, link.documentId, new Uint8Array(await object.arrayBuffer()), {
      signatureType: body.signatureType, signatureData: body.signatureData, signerName: body.signerName,
      signerEmail: link.recipientEmail, consentAgreed: true,
      ipAddress: c.req.header("cf-connecting-ip") || "unavailable", userAgent: c.req.header("user-agent") || "unavailable",
    });
    await consumeSigningAccess(db, link.linkId);
    return c.json({ ok: true, certificateId: result.certificateId, documentHash: result.documentHash });
  } catch (error) {
    await releaseSigningAccess(db, link.linkId);
    return c.json({ error: error instanceof Error ? error.message : "Could not complete this signature." }, 422);
  }
});
