import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { sha256Hex } from "./documents";
import { generatePortalToken, hashPortalToken } from "./portal";
import { activeDocumentReaders, type DocumentReader } from "../providers/llm";

/**
 * Taxpayer consents under IRC § 7216, Treas. Reg. § 301.7216-3 and Rev. Proc. 2013-14.
 *
 * Why a disclosure consent is needed: Truepost and the outside document-reading
 * services it uses are "tax return preparers" providing auxiliary services
 * (§ 301.7216-1(b)(2)(i)(B)). The preparer-to-preparer exception in
 * § 301.7216-2(d)(1) covers only recipients located in the United States, and those
 * services do not guarantee US-only processing. Consent is therefore obtained before
 * any receipt is sent for automatic reading, using the mandatory statements in
 * Rev. Proc. 2013-14 § 5.04(1)(b), (d) and (e)(i), verbatim and in sequence.
 *
 * SSNs: § 301.7216-3(b)(4) bars consent to disclose an SSN to a preparer outside the
 * US absent an adequate data protection safeguard (Rev. Proc. 2013-14 § 5.07), so the
 * consent excludes documents showing a full SSN; those stay in Documents, which is
 * never sent for automatic reading.
 *
 * Draft for review by a licensed attorney before production reliance.
 */
export const CONSENT_TEXT_VERSION = "2026-09-22";
export type ConsentKind = "disclosure_document_reading" | "use_bookkeeping";
export const CONSENT_KINDS: ConsentKind[] = ["disclosure_document_reading", "use_bookkeeping"];
const PLATFORM_RECIPIENT = { id: "truepost", label: "Truepost, a software service operated by Solis Equity Holdings LLC that we use to organize your records" };
const REQUEST_TTL_DAYS = 14;
const TIGTA_STATEMENT =
  "If you believe your tax return information has been disclosed or used improperly in a manner unauthorized by law or without your permission, you may contact the Treasury Inspector General for Tax Administration (TIGTA) by telephone at 1-800-366-4484, or by email at complaints@tigta.treas.gov.";

export class ConsentError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 422 = 400) {
    super(message);
  }
}

export type ConsentParties = { preparerName: string; taxpayerName: string; readers: DocumentReader[] };

/** § 301.7216-2(d)(1) needs no consent for US-located auxiliary-service recipients; consent is required once any reader is outside the US. */
export function consentRequired(readers: DocumentReader[]): boolean {
  return readers.some((r) => !r.usOnly);
}

function readerList(readers: DocumentReader[]): string {
  return readers.map((r) => `${r.legalName} (${r.service})`).join("; ");
}

export function consentTitle(kind: ConsentKind): string {
  return kind === "disclosure_document_reading" ? "Consent to Disclosure of Tax Return Information" : "Consent to Use of Tax Return Information";
}

/** The complete consent document. Everything shown on the consent screen comes from here. */
export function buildConsentText(kind: ConsentKind, parties: ConsentParties): string {
  const who = `Tax return preparer: ${parties.preparerName} ("we", "us", "our"). Taxpayer: ${parties.taxpayerName}.`;
  const duration = "How long it lasts. This consent is valid until the end date shown with your signature. If you do not choose an end date, it is valid for one year from the date you sign.";
  const revoke = "Revoking. You may revoke this consent at any time by telling us in writing. Revoking stops future disclosures and uses; it does not undo those made before we receive your notice.";

  if (kind === "disclosure_document_reading") {
    return [
      consentTitle(kind).toUpperCase(),
      "Federal law requires this consent form be provided to you. Unless authorized by law, we cannot disclose your tax return information to third parties for purposes other than those related to the preparation and filing of your tax return without your consent. If you consent to the disclosure of your tax return information, Federal law may not protect your tax return information from further use or distribution.",
      "You are not required to complete this form. Because our ability to disclose your tax return information to another tax return preparer affects the tax return preparation service(s) that we provide to you and its (their) cost, we may decline to provide you with tax return preparation services or change the terms (including the cost) of the tax return preparation services that we provide to you if you do not sign this form. If you agree to the disclosure of your tax return information, your consent is valid for the amount of time that you specify. If you do not specify the duration of your consent, your consent is valid for one year from the date of signature.",
      ...(consentRequired(parties.readers) ? ["This consent to disclose may result in your tax return information being disclosed to a tax return preparer located outside the United States."] : []),
      who,
      "What would be disclosed. Images and copies of receipts, invoices, and bank and credit card statements that you or we upload to your account in Truepost; the details read from them, such as dates, merchant names, amounts, and payment methods; and your business name, entity type, industry, and state, together with our categorization instructions for your account.",
      `Who would receive it. ${PLATFORM_RECIPIENT.label}, and the automated document-reading services Truepost uses: ${readerList(parties.readers)}.${consentRequired(parties.readers) ? " These services may process information outside the United States." : " These services process information only in the United States."}`,
      "Why. So these services can read your documents automatically and suggest the date, merchant, amount, and category of each item. We review every suggestion before it is used in your books or tax return.",
      "What is not included. Do not submit W-2s, 1099s, tax returns, or other documents that show your full Social Security number for automatic reading. We handle those documents without sending them to these services.",
      "If you do not sign. We will enter your documents by hand instead.",
      revoke,
      duration,
      TIGTA_STATEMENT,
    ].join("\n\n");
  }

  return [
    consentTitle(kind).toUpperCase(),
    "Federal law requires this consent form be provided to you. Unless authorized by law, we cannot use your tax return information for purposes other than the preparation and filing of your tax return without your consent.",
    "You are not required to complete this form to engage our tax return preparation services. If we obtain your signature on this form by conditioning our tax return preparation services on your consent, your consent will not be valid. Your consent is valid for the amount of time that you specify. If you do not specify the duration of your consent, your consent is valid for one year from the date of signature.",
    who,
    "What would be used. The information you give us to prepare your tax return, including receipts, invoices, and bank and credit card statements, and the details read from them.",
    "Why. To keep your bookkeeping records and prepare financial statements for you, such as monthly and yearly profit and loss statements.",
    revoke,
    duration,
    TIGTA_STATEMENT,
  ].join("\n\n");
}

export function authorizationLine(kind: ConsentKind, parties: ConsentParties, typedName: string): string {
  return kind === "disclosure_document_reading"
    ? `I, ${typedName}, authorize ${parties.preparerName} to disclose the tax return information described above to the recipients named above for the purpose described above.`
    : `I, ${typedName}, authorize ${parties.preparerName} to use the tax return information described above for the purpose described above.`;
}

export async function consentParties(db: Db, env: Env, firmId: string, clientId: string): Promise<ConsentParties> {
  const [row] = await db.query<{ firm_name: string; client_name: string; legal_name: string | null }>(
    `SELECT f.name AS firm_name, c.name AS client_name, c.legal_name FROM clients c JOIN firms f ON f.id = c.firm_id WHERE c.id=$1 AND c.firm_id=$2`,
    [clientId, firmId],
  );
  if (!row) throw new ConsentError("Client not found.", 404);
  return { preparerName: row.firm_name, taxpayerName: row.legal_name || row.client_name, readers: activeDocumentReaders(env) };
}

/** Default one year from signing (Rev. Proc. 2013-14 § 5.04(1)); a chosen end date must be after today and within five years. */
export function resolveExpiry(signedAt: Date, chosen?: string | null): string {
  const oneYear = new Date(signedAt); oneYear.setUTCFullYear(oneYear.getUTCFullYear() + 1);
  if (!chosen) return oneYear.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosen)) throw new ConsentError("Choose a valid end date.", 422);
  const max = new Date(signedAt); max.setUTCFullYear(max.getUTCFullYear() + 5);
  const date = new Date(`${chosen}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date <= signedAt || date > max) throw new ConsentError("The end date must be after today and within five years.", 422);
  return chosen;
}

export async function createConsentRequest(db: Db, firmId: string, clientId: string, userId: string) {
  const token = generatePortalToken();
  const expiresAt = new Date(Date.now() + REQUEST_TTL_DAYS * 86_400_000).toISOString();
  await db.transaction([
    { query: `UPDATE consent_requests SET revoked_at=NOW() WHERE client_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`, params: [clientId] },
    { query: `INSERT INTO consent_requests (id, firm_id, client_id, token_hash, expires_at, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      params: [newId("cnreq"), firmId, clientId, await hashPortalToken(token), expiresAt, userId] },
  ]);
  return { token, expiresAt };
}

export type ConsentRequestRow = { id: string; firm_id: string; client_id: string; expires_at: string };

export async function resolveConsentRequest(db: Db, token: string): Promise<ConsentRequestRow> {
  if (!token || token.length < 32) throw new ConsentError("This consent link is unavailable. Ask your preparer for a new link.", 403);
  const [row] = await db.query<ConsentRequestRow>(
    `SELECT id, firm_id, client_id, expires_at FROM consent_requests
     WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
    [await hashPortalToken(token)],
  );
  if (!row) throw new ConsentError("This consent link is unavailable. Ask your preparer for a new link.", 403);
  return row;
}

async function insertConsent(db: Db, input: {
  firmId: string; clientId: string; kind: ConsentKind; parties: ConsentParties; typedName: string;
  method: "typed_name" | "paper"; signedAt: Date; expiresOn: string; ip?: string | null; userAgent?: string | null;
  paperR2Key?: string | null; requestId?: string | null; recordedBy?: string | null;
}) {
  const text = `${buildConsentText(input.kind, input.parties)}\n\n${authorizationLine(input.kind, input.parties, input.typedName)}\n\nSigned: ${input.typedName} (${input.method === "paper" ? "handwritten signature on paper" : "typed name"}), ${input.signedAt.toISOString().slice(0, 10)}. Valid until ${input.expiresOn}.`;
  const recipients = input.kind === "disclosure_document_reading" ? [PLATFORM_RECIPIENT.id, ...input.parties.readers.map((r) => r.id)] : [];
  const id = newId("cns");
  await db.query(
    `INSERT INTO taxpayer_consents (id, firm_id, client_id, consent_kind, text_version, consent_text, text_sha256, recipients,
       preparer_name, taxpayer_name, signature_method, signed_at, expires_on, signer_ip, signer_user_agent, paper_r2_key,
       consent_request_id, recorded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [id, input.firmId, input.clientId, input.kind, CONSENT_TEXT_VERSION, text, await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer),
      JSON.stringify(recipients), input.parties.preparerName, input.typedName, input.method, input.signedAt.toISOString(), input.expiresOn,
      input.ip ?? null, input.userAgent ?? null, input.paperR2Key ?? null, input.requestId ?? null, input.recordedBy ?? null],
  );
  await db.query(
    `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,'taxpayer_consent_signed',$4,$5::jsonb,NOW())`,
    [newId("aud"), input.firmId, input.clientId, input.recordedBy ?? "taxpayer", JSON.stringify({ consentId: id, kind: input.kind, method: input.method, expiresOn: input.expiresOn, recipients })],
  );
  return { id, consentText: text, expiresOn: input.expiresOn };
}

/** Electronic signature by typed name (Rev. Proc. 2013-14 § 6.02(b)); the name is never pre-filled. */
export async function signConsentElectronically(db: Db, env: Env, request: ConsentRequestRow, input: {
  kind: ConsentKind; authorized: boolean; typedName: string; expiresOn?: string | null; ip: string | null; userAgent: string | null;
}) {
  if (!CONSENT_KINDS.includes(input.kind)) throw new ConsentError("Unknown consent.", 400);
  if (input.authorized !== true) throw new ConsentError("Check the box to give this consent.", 422);
  const typedName = input.typedName.trim().replace(/\s+/g, " ");
  if (typedName.length < 2) throw new ConsentError("Type your full name to sign.", 422);
  const parties = await consentParties(db, env, request.firm_id, request.client_id);
  if (input.kind === "disclosure_document_reading" && parties.readers.length === 0) {
    throw new ConsentError("Automatic document reading is not in use, so this consent is not needed.", 409);
  }
  const [already] = await db.query(`SELECT 1 FROM taxpayer_consents WHERE consent_request_id=$1 AND consent_kind=$2`, [request.id, input.kind]);
  if (already) throw new ConsentError("You already signed this consent with this link.", 409);
  const signedAt = new Date();
  return insertConsent(db, {
    firmId: request.firm_id, clientId: request.client_id, kind: input.kind, parties, typedName, method: "typed_name", signedAt,
    expiresOn: resolveExpiry(signedAt, input.expiresOn), ip: input.ip, userAgent: input.userAgent, requestId: request.id,
  });
}

export async function finishConsentRequest(db: Db, request: ConsentRequestRow) {
  await db.query(`UPDATE consent_requests SET consumed_at=NOW() WHERE id=$1 AND consumed_at IS NULL`, [request.id]);
}

/** Staff record a consent the taxpayer signed by hand on the printed form. */
export async function recordPaperConsent(db: Db, env: Env, input: {
  firmId: string; clientId: string; userId: string; kind: ConsentKind; taxpayerName: string; signedOn: string; expiresOn?: string | null; scan: Uint8Array; contentType: string;
}) {
  if (!CONSENT_KINDS.includes(input.kind)) throw new ConsentError("Unknown consent.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.signedOn)) throw new ConsentError("Enter the date the taxpayer signed.", 422);
  const signedAt = new Date(`${input.signedOn}T12:00:00Z`);
  if (signedAt.getTime() > Date.now()) throw new ConsentError("The signing date cannot be in the future.", 422);
  if (!input.taxpayerName.trim()) throw new ConsentError("Enter the name the taxpayer signed.", 422);
  if (!["application/pdf", "image/jpeg", "image/png"].includes(input.contentType) || input.scan.byteLength === 0) throw new ConsentError("Attach the signed form as a PDF, JPEG or PNG.", 422);
  const parties = await consentParties(db, env, input.firmId, input.clientId);
  const key = `consents/${input.firmId}/${input.clientId}/${newId("scan")}.${input.contentType === "application/pdf" ? "pdf" : input.contentType === "image/png" ? "png" : "jpg"}`;
  await env.RECEIPTS.put(key, input.scan, { httpMetadata: { contentType: input.contentType } });
  return insertConsent(db, {
    firmId: input.firmId, clientId: input.clientId, kind: input.kind, parties, typedName: input.taxpayerName.trim(), method: "paper",
    signedAt, expiresOn: resolveExpiry(signedAt, input.expiresOn), paperR2Key: key, recordedBy: input.userId,
  });
}

export async function revokeConsent(db: Db, firmId: string, clientId: string, consentId: string, userId: string, note: string) {
  const rows = await db.query(
    `UPDATE taxpayer_consents SET revoked_at=NOW(), revoked_by=$1, revocation_note=$2 WHERE id=$3 AND firm_id=$4 AND client_id=$5 AND revoked_at IS NULL RETURNING id`,
    [userId, note, consentId, firmId, clientId],
  );
  if (!rows.length) throw new ConsentError("Consent not found or already revoked.", 404);
  await db.query(`INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,'taxpayer_consent_revoked',$4,$5::jsonb,NOW())`,
    [newId("aud"), firmId, clientId, userId, JSON.stringify({ consentId, note })]);
}

export async function listConsents(db: Db, firmId: string, clientId: string) {
  return db.query<{
    id: string; consent_kind: ConsentKind; taxpayer_name: string; signature_method: string; signed_at: string; expires_on: string;
    recipients: string[]; revoked_at: string | null; revocation_note: string | null; text_version: string;
  }>(
    `SELECT id, consent_kind, taxpayer_name, signature_method, signed_at, expires_on, recipients, revoked_at, revocation_note, text_version
     FROM taxpayer_consents WHERE firm_id=$1 AND client_id=$2 ORDER BY signed_at DESC`,
    [firmId, clientId],
  );
}

/**
 * True when the client has an unrevoked, unexpired disclosure consent naming Truepost and
 * every document-reading service currently configured. A consent that does not name a
 * newly added service does not cover it.
 */
export async function hasDocumentReadingConsent(db: Db, clientId: string, readerIds: string[]): Promise<boolean> {
  const required = [PLATFORM_RECIPIENT.id, ...readerIds];
  const [row] = await db.query(
    `SELECT 1 FROM taxpayer_consents
     WHERE client_id=$1 AND consent_kind='disclosure_document_reading' AND revoked_at IS NULL
       AND expires_on >= CURRENT_DATE AND recipients @> $2::jsonb
     LIMIT 1`,
    [clientId, JSON.stringify(required)],
  );
  return Boolean(row);
}

export async function documentReadingStatus(db: Db, env: Env, clientId: string) {
  const readers = activeDocumentReaders(env);
  if (!consentRequired(readers)) return { required: false, covered: true, readers };
  return { required: true, covered: await hasDocumentReadingConsent(db, clientId, readers.map((r) => r.id)), readers };
}
