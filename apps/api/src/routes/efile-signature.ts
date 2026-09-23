import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { issueSigningAccessLink, claimSigningAccess, consumeSigningAccess, releaseSigningAccess } from "../services/signature-access";
import { resolveKbaProvider, KBA_MAX_ATTEMPTS } from "../services/kba-providers";
import { resolvePublicSigningLink } from "./public-signing";
import {
  EfileSignatureError, acceptHandwrittenCopy, createEfileAuthorization, findMultiYearRelationship, getEfileAuthorization,
  listEfileAuthorizations, readPreparedForm, readSealedRecord, receiveHandwrittenCopy, rejectHandwrittenCopy, signInPerson,
  verifyEfileEvidence, voidEfileAuthorization, type EfileAuthorizationRow,
} from "../services/efile-signature";

function fail(c: any, error: unknown) {
  if (error instanceof EfileSignatureError) return c.json({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message ?? "Invalid request" }, 400);
  throw error;
}

function pdf(bytes: Uint8Array, filename: string) {
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "no-store" } });
}

function kbaStatus(env: Env) {
  const status = resolveKbaProvider(env);
  return status.enabled
    ? { enabled: true, provider: status.provider.displayName, maxAttempts: KBA_MAX_ATTEMPTS }
    : { enabled: false, reason: status.reason, providers: status.providers, maxAttempts: KBA_MAX_ATTEMPTS };
}

async function fileBytes(form: FormData, field = "file"): Promise<Uint8Array> {
  const entry = form.get(field);
  if (!entry || typeof entry === "string") throw new EfileSignatureError("Attach a file.", 400);
  return new Uint8Array(await (entry as File).arrayBuffer());
}

/* ---------- Staff routes, mounted at /api/clients ---------- */

export const efileSignatureRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
efileSignatureRoutes.use("*", requireSession);

async function scope(c: any) {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) throw new EfileSignatureError("Client not found.", 404);
  return { db, firmId: firm.id as string, clientId: client.id as string };
}

async function scopedAuthorization(c: any): Promise<{ db: ReturnType<typeof createDb>; auth: EfileAuthorizationRow }> {
  const { db, firmId, clientId } = await scope(c);
  return { db, auth: await getEfileAuthorization(db, firmId, clientId, c.req.param("id")) };
}

efileSignatureRoutes.get("/:clientId/efile-authorizations", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    return c.json({ authorizations: await listEfileAuthorizations(db, firmId, clientId), remoteSigning: kbaStatus(c.env) });
  } catch (error) { return fail(c, error); }
});

const createSchema = z.object({
  formType: z.enum(["8879", "8878"]),
  taxYear: z.coerce.number().int().min(2000).max(2100),
  taxReturnId: z.string().trim().optional().transform((v) => v || null),
  taxpayerRole: z.enum(["primary", "spouse"]).default("primary"),
  taxpayerName: z.string().trim().min(1, "Enter the taxpayer's name."),
  taxpayerEmail: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")).transform((v) => v || null),
  spouseName: z.string().trim().optional().transform((v) => v || null),
  spouseEmail: z.string().trim().email("Enter a valid spouse email.").optional().or(z.literal("")).transform((v) => v || null),
});

efileSignatureRoutes.post("/:clientId/efile-authorizations", async (c) => {
  try {
    const { db, firmId, clientId } = await scope(c);
    const form = await c.req.formData();
    const fields = createSchema.parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
    const { spouseName, spouseEmail, ...primary } = fields;
    const formPdf = await fileBytes(form);
    const authorization = await createEfileAuthorization(db, c.env, { firmId, clientId, userId: c.get("userId"), ...primary, formPdf });
    // Joint return: each spouse signs their own authorization for the same return (Pub 1345).
    const spouse = spouseName && primary.taxpayerRole === "primary"
      ? await createEfileAuthorization(db, c.env, { firmId, clientId, userId: c.get("userId"), ...primary, taxpayerRole: "spouse", taxpayerName: spouseName, taxpayerEmail: spouseEmail, formPdf })
      : null;
    return c.json({ authorization, spouse }, 201);
  } catch (error) { return fail(c, error); }
});

efileSignatureRoutes.get("/:clientId/efile-authorizations/:id/prepared", async (c) => {
  try { const { auth } = await scopedAuthorization(c); return pdf(await readPreparedForm(c.env, auth), `Form-${auth.form_type}-${auth.tax_year}-prepared.pdf`); }
  catch (error) { return fail(c, error); }
});

efileSignatureRoutes.get("/:clientId/efile-authorizations/:id/received", async (c) => {
  try {
    const { auth } = await scopedAuthorization(c);
    if (!auth.received_r2_key) throw new EfileSignatureError("No signed copy has been received.", 404);
    const object = await c.env.RECEIPTS.get(auth.received_r2_key);
    if (!object) throw new EfileSignatureError("The received copy is no longer available.", 404);
    return new Response(object.body, { headers: { "Content-Type": auth.received_content_type ?? "application/octet-stream", "Cache-Control": "no-store" } });
  } catch (error) { return fail(c, error); }
});

efileSignatureRoutes.get("/:clientId/efile-authorizations/:id/sealed", async (c) => {
  try { const { db, auth } = await scopedAuthorization(c); return pdf(await readSealedRecord(db, c.env, auth), `Form-${auth.form_type}-${auth.tax_year}-signed.pdf`); }
  catch (error) { return fail(c, error); }
});

/** Staff received the pen-signed form by fax, email or mail and attest it is signed and dated. */
efileSignatureRoutes.post("/:clientId/efile-authorizations/:id/handwritten", async (c) => {
  try {
    const { db, auth } = await scopedAuthorization(c);
    const form = await c.req.formData();
    if (form.get("attestSignedAndDated") !== "true") throw new EfileSignatureError("Confirm the taxpayer signed and dated the form.", 422);
    const received = await receiveHandwrittenCopy(db, c.env, auth, { bytes: await fileBytes(form), ip: null, userAgent: null, actor: c.get("userId") });
    return c.json({ sealed: await acceptHandwrittenCopy(db, c.env, received, c.get("userId")) });
  } catch (error) { return fail(c, error); }
});

efileSignatureRoutes.post("/:clientId/efile-authorizations/:id/handwritten/accept", async (c) => {
  try { const { db, auth } = await scopedAuthorization(c); return c.json({ sealed: await acceptHandwrittenCopy(db, c.env, auth, c.get("userId")) }); }
  catch (error) { return fail(c, error); }
});

efileSignatureRoutes.post("/:clientId/efile-authorizations/:id/handwritten/reject", async (c) => {
  try {
    const { db, auth } = await scopedAuthorization(c);
    const { reason } = z.object({ reason: z.string().trim().min(1, "Say why the copy was rejected.") }).parse(await c.req.json());
    await rejectHandwrittenCopy(db, auth, c.get("userId"), reason);
    return c.json({ ok: true });
  } catch (error) { return fail(c, error); }
});

const signatureSchema = z.object({
  signatureType: z.enum(["drawn", "typed"]),
  signatureData: z.string().min(1).max(500_000),
  signerName: z.string().trim().min(1, "Enter the signer's legal name."),
  taxpayerPin: z.string().trim(),
});

const inPersonSchema = z.object({
  signature: signatureSchema,
  placement: z.object({ page: z.number().int().min(0).max(200), xPct: z.number().min(0).max(1), yPct: z.number().min(0).max(1) }).nullable().optional(),
  identity: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("multi_year") }),
    z.object({ mode: z.literal("photo_id"), inspection: z.object({
      idType: z.enum(["drivers_license", "state_id", "passport", "military_id", "other_government_id"]),
      idNumberLast4: z.string().trim(), legalName: z.string().trim(), ssnLast4: z.string().trim(),
      address: z.string().trim(), dateOfBirth: z.string().trim(), photoMatchesTaxpayer: z.literal(true),
    }) }),
  ]),
});

efileSignatureRoutes.get("/:clientId/efile-authorizations/:id/multi-year", async (c) => {
  try { const { db, auth } = await scopedAuthorization(c); return c.json({ relationship: await findMultiYearRelationship(db, auth) }); }
  catch (error) { return fail(c, error); }
});

efileSignatureRoutes.post("/:clientId/efile-authorizations/:id/sign-in-person", async (c) => {
  try {
    const { db, auth } = await scopedAuthorization(c);
    const body = inPersonSchema.parse(await c.req.json());
    return c.json({ sealed: await signInPerson(db, c.env, auth, { hostUserId: c.get("userId"), signature: body.signature, identity: body.identity, userAgent: c.req.header("user-agent") ?? null, placement: body.placement ?? null }) });
  } catch (error) { return fail(c, error); }
});

/** Secure link the taxpayer uses to download the form and upload the pen-signed copy. */
efileSignatureRoutes.post("/:clientId/efile-authorizations/:id/signing-link", async (c) => {
  try {
    const { db, auth } = await scopedAuthorization(c);
    if (auth.status !== "awaiting_signature") throw new EfileSignatureError(auth.status === "handwritten_received" ? "A signed copy is already waiting for your review." : `This authorization is ${auth.status}.`, 409);
    if (!auth.taxpayer_email) throw new EfileSignatureError("Add the taxpayer's email before creating a signing link.", 400);
    const link = await issueSigningAccessLink(db, { firmId: auth.firm_id, clientId: auth.client_id, requestId: auth.signature_request_id, recipientEmail: auth.taxpayer_email, recipientName: auth.taxpayer_name, issuedByUserId: c.get("userId") });
    await db.query(`UPDATE signature_requests SET status='sent', sent_at=COALESCE(sent_at,NOW()) WHERE id=$1 AND status='pending'`, [auth.signature_request_id]);
    const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
    return c.json({ signingUrl: `${origin}/sign#token=${encodeURIComponent(link.token)}`, expiresAt: link.expiresAt }, 201);
  } catch (error) { return fail(c, error); }
});

efileSignatureRoutes.get("/:clientId/efile-authorizations/:id/verify", async (c) => {
  try { const { db, auth } = await scopedAuthorization(c); return c.json(await verifyEfileEvidence(db, c.env, auth)); }
  catch (error) { return fail(c, error); }
});

/** Everything Publication 1345 says the ERO must provide to the IRS on request, in one file. */
efileSignatureRoutes.get("/:clientId/efile-authorizations/:id/evidence-packet", async (c) => {
  try {
    const { db, auth } = await scopedAuthorization(c);
    const [evidence] = await db.query<any>(`SELECT * FROM efile_signature_evidence WHERE authorization_id=$1`, [auth.id]);
    if (!evidence) throw new EfileSignatureError("This authorization has not been signed.", 409);
    const attempts = await db.query<any>(`SELECT provider, outcome, provider_reference, attempted_at FROM efile_kba_attempts WHERE authorization_id=$1 ORDER BY attempted_at`, [auth.id]);
    const remote = evidence.method === "remote_kba_esign";
    const packet = {
      standard: "IRS Publication 1345 (Rev. 12-2025), Electronic Signature Guidance for Forms 8878 and 8879",
      form: { type: auth.form_type, taxYear: auth.tax_year, taxReturnId: auth.tax_return_id, taxpayerRole: auth.taxpayer_role },
      digitalImageOfSignedForm: { sha256: evidence.signed_hash, download: `/api/clients/${auth.client_id}/efile-authorizations/${auth.id}/sealed` },
      signatureDateTime: evidence.signed_at,
      taxpayerIpAddress: remote ? evidence.signer_ip : "not applicable: not a remote electronic signature",
      taxpayerLogin: remote ? evidence.signer_login : "not applicable: not a remote electronic signature",
      identityVerification: evidence.identity_check,
      identityVerificationAttempts: attempts,
      signingMethod: { method: evidence.method, signatureType: evidence.signature_type, signerName: evidence.signer_name },
      preparedFormSha256: evidence.unsigned_hash,
      retainUntil: evidence.retain_until,
      integrity: await verifyEfileEvidence(db, c.env, auth),
    };
    return new Response(JSON.stringify(packet, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="Form-${auth.form_type}-${auth.tax_year}-evidence.json"`, "Cache-Control": "no-store" } });
  } catch (error) { return fail(c, error); }
});

efileSignatureRoutes.post("/:clientId/efile-authorizations/:id/void", async (c) => {
  try {
    const { db, auth } = await scopedAuthorization(c);
    const { reason } = z.object({ reason: z.string().trim().min(1, "Give a reason for voiding.") }).parse(await c.req.json());
    await voidEfileAuthorization(db, auth, c.get("userId"), reason);
    return c.json({ ok: true });
  } catch (error) { return fail(c, error); }
});

/* ---------- Taxpayer link routes, mounted at /api/signing/efile ---------- */

export const publicEfileSigningRoutes = new Hono<{ Bindings: Env }>();

async function linkedAuthorization(c: any) {
  const link = await resolvePublicSigningLink(c);
  if (!link) throw new EfileSignatureError("This signing link is unavailable. Ask your firm for a new link.", 403);
  const db = createDb(c.env);
  const [auth] = await db.query<EfileAuthorizationRow>(`SELECT * FROM efile_authorizations WHERE signature_request_id=$1 AND firm_id=$2 AND client_id=$3`, [link.requestId, link.firmId, link.clientId]);
  if (!auth || auth.status !== "awaiting_signature") throw new EfileSignatureError("This signing link is unavailable. Ask your firm for a new link.", 403);
  return { db, link, auth };
}

publicEfileSigningRoutes.get("/me", async (c) => {
  try {
    const { link, auth } = await linkedAuthorization(c);
    return c.json({ authorization: { formType: auth.form_type, taxYear: auth.tax_year, taxpayerName: auth.taxpayer_name, expiresAt: link.expiresAt }, remoteSigning: { enabled: resolveKbaProvider(c.env).enabled } });
  } catch (error) { return fail(c, error); }
});

publicEfileSigningRoutes.get("/form", async (c) => {
  try { const { auth } = await linkedAuthorization(c); return pdf(await readPreparedForm(c.env, auth), `Form-${auth.form_type}-${auth.tax_year}.pdf`); }
  catch (error) { return fail(c, error); }
});

publicEfileSigningRoutes.post("/handwritten", async (c) => {
  let claimed: { db: ReturnType<typeof createDb>; linkId: string } | null = null;
  try {
    const { db, link, auth } = await linkedAuthorization(c);
    const bytes = await fileBytes(await c.req.formData());
    if (!(await claimSigningAccess(db, link.linkId))) throw new EfileSignatureError("This signing link was just used or is no longer available.", 409);
    claimed = { db, linkId: link.linkId };
    await receiveHandwrittenCopy(db, c.env, auth, { bytes, ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null, actor: link.recipientEmail });
    await consumeSigningAccess(db, link.linkId);
    return c.json({ ok: true });
  } catch (error) {
    if (claimed) await releaseSigningAccess(claimed.db, claimed.linkId);
    return fail(c, error);
  }
});
