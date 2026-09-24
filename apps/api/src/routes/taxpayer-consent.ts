import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import {
  CONSENT_KINDS, ConsentError, consentRequired, authorizationLine, buildConsentText, consentParties, consentTitle, createConsentRequest,
  documentReadingStatus, finishConsentRequest, listConsents, recordPaperConsent, resolveConsentRequest, revokeConsent,
  signConsentElectronically, type ConsentKind,
} from "../services/taxpayer-consent";

function fail(c: any, error: unknown) {
  if (error instanceof ConsentError) return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message ?? "Invalid request" }, 400);
  throw error;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const kindSchema = z.enum(CONSENT_KINDS as [ConsentKind, ...ConsentKind[]]);

/* ---------- Staff routes, mounted at /api/clients ---------- */

export const consentRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

async function scope(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) throw new ConsentError("Client not found.", 404);
  return { db, firmId: firm.id as string, clientId: client.id as string };
}

consentRoutes.get("/:clientId/consents", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    return c.json({ consents: await listConsents(db, firmId, clientId), documentReading: await documentReadingStatus(db, c.env, clientId), emailConfigured: Boolean(c.env.RESEND_API_KEY) });
  } catch (error) { return fail(c, error); }
});

consentRoutes.post("/:clientId/consents/link", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const link = await createConsentRequest(db, firmId, clientId, c.get("userId"));
    const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
    return c.json({ consentUrl: `${origin}/consent#token=${encodeURIComponent(link.token)}`, expiresAt: link.expiresAt }, 201);
  } catch (error) { return fail(c, error); }
});

/** Printable form for a handwritten signature: 12-point type, letter size, only consent text on the page (Rev. Proc. 2013-14 § 5.02). */
consentRoutes.get("/:clientId/consents/printable", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const kind = kindSchema.parse(c.req.query("kind"));
    const parties = await consentParties(db, c.env, firmId, clientId);
    const body = buildConsentText(kind, parties).split("\n\n").map((p, i) => i === 0 ? `<h1>${escapeHtml(p)}</h1>` : `<p>${escapeHtml(p)}</p>`).join("");
    const line = escapeHtml(authorizationLine(kind, parties, "____________________________"));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(consentTitle(kind))}</title>
<style>@page{size:letter;margin:0.75in}body{font:12pt/1.45 Georgia,serif;color:#000;background:#fff;max-width:7in;margin:0 auto}h1{font-size:13pt;letter-spacing:.04em}p{margin:0 0 10pt}.sig{margin-top:24pt}.sig div{margin:18pt 0 0;border-top:1px solid #000;padding-top:3pt;width:4in}</style></head>
<body>${body}<p class="sig">&#9744; ${line}</p><div class="sig"><div>Taxpayer signature</div><div>Date</div><div>End date (optional; one year if blank)</div></div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) { return fail(c, error); }
});

consentRoutes.post("/:clientId/consents/paper", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const form = await c.req.formData();
    const fields = z.object({
      kind: kindSchema,
      taxpayerName: z.string().trim().min(1, "Enter the name the taxpayer signed."),
      signedOn: z.string(),
      expiresOn: z.string().optional().transform((v) => v || null),
    }).parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
    const file = form.get("file");
    if (!file || typeof file === "string") throw new ConsentError("Attach the signed form.", 400);
    const scan = file as File;
    const consent = await recordPaperConsent(db, c.env, { firmId, clientId, userId: c.get("userId"), ...fields, scan: new Uint8Array(await scan.arrayBuffer()), contentType: scan.type });
    return c.json({ consent }, 201);
  } catch (error) { return fail(c, error); }
});

consentRoutes.post("/:clientId/consents/:id/revoke", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const { note } = z.object({ note: z.string().trim().min(1, "Note how the taxpayer revoked (for example, email of 9/22).") }).parse(await c.req.json());
    await revokeConsent(db, firmId, clientId, c.req.param("id"), c.get("userId"), note);
    return c.json({ ok: true });
  } catch (error) { return fail(c, error); }
});

consentRoutes.get("/:clientId/consents/:id/text", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const [row] = await db.query<{ consent_text: string; text_sha256: string }>(`SELECT consent_text, text_sha256 FROM taxpayer_consents WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [c.req.param("id"), firmId, clientId]);
    if (!row) throw new ConsentError("Consent not found.", 404);
    return new Response(`${row.consent_text}\n\nRecord SHA-256: ${row.text_sha256}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) { return fail(c, error); }
});

/* ---------- Taxpayer link routes, mounted at /api/consent ---------- */

export const publicConsentRoutes = new Hono<{ Bindings: Env }>();

function bearer(c: any): string {
  const value = c.req.header("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : "";
}

publicConsentRoutes.get("/me", async (c) => {
  try {
    const db = createDb(c.env);
    const request = await resolveConsentRequest(db, bearer(c));
    const parties = await consentParties(db, c.env, request.firm_id, request.client_id);
    const signed = await db.query<{ consent_kind: ConsentKind }>(`SELECT consent_kind FROM taxpayer_consents WHERE consent_request_id=$1`, [request.id]);
    const kinds = CONSENT_KINDS.filter((k) => k !== "disclosure_document_reading" || consentRequired(parties.readers));
    return c.json({
      preparerName: parties.preparerName,
      taxpayerName: parties.taxpayerName,
      expiresAt: request.expires_at,
      documents: kinds.map((kind) => ({ kind, title: consentTitle(kind), text: buildConsentText(kind, parties), authorization: authorizationLine(kind, parties, "{name}") })),
      signedKinds: signed.map((s) => s.consent_kind),
    });
  } catch (error) { return fail(c, error); }
});

publicConsentRoutes.post("/sign", async (c) => {
  try {
    const db = createDb(c.env);
    const request = await resolveConsentRequest(db, bearer(c));
    const body = z.object({
      kind: kindSchema,
      authorized: z.boolean(),
      typedName: z.string(),
      expiresOn: z.string().optional().nullable(),
    }).parse(await c.req.json());
    const result = await signConsentElectronically(db, c.env, request, { ...body, ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null });
    return c.json({ consentText: result.consentText, expiresOn: result.expiresOn }, 201);
  } catch (error) { return fail(c, error); }
});

publicConsentRoutes.post("/finish", async (c) => {
  try {
    const db = createDb(c.env);
    await finishConsentRequest(db, await resolveConsentRequest(db, bearer(c)));
    return c.json({ ok: true });
  } catch (error) { return fail(c, error); }
});
