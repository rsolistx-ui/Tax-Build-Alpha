import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { sha256Hex } from "./documents";
import { KBA_MAX_ATTEMPTS, resolveKbaProvider } from "./kba-providers";

/**
 * IRS Form 8878/8879 signature authorizations, per Publication 1345
 * (Rev. 12-2025), "Electronic Signature Guidance for Forms 8878 and 8879".
 *
 * Zero-cost methods, available now:
 *  - handwritten_upload: a pen-signed form returned by fax, email or website is
 *    not a remote electronic signature, so no identity check applies (p.17).
 *    Client uploads wait in `handwritten_received` until staff confirm the form
 *    is actually signed and dated.
 *  - in_person_esign: ERO physically present; government photo ID inspected
 *    and name/SSN/address/DOB recorded, or a verified multi-year relationship.
 * Vendor-gated method, off until a KBA provider is connected:
 *  - remote_kba_esign: remote electronic signature after passing credit-bureau
 *    KBA; three failed attempts force a handwritten signature (p.17).
 */
export type EfileFormType = "8879" | "8878";
export type EfileSigningMethod = "handwritten_upload" | "in_person_esign" | "remote_kba_esign";
export type TaxpayerRole = "primary" | "spouse";

export type PhotoIdInspection = {
  idType: "drivers_license" | "state_id" | "passport" | "military_id" | "other_government_id";
  idNumberLast4: string;
  legalName: string;
  ssnLast4: string;
  address: string;
  dateOfBirth: string;
  photoMatchesTaxpayer: true;
};

export type IdentityCheck =
  | ({ type: "photo_id_inspected"; inspectedByUserId: string } & PhotoIdInspection)
  | { type: "multi_year_relationship"; priorEvidenceId: string; priorTaxYear: number }
  | { type: "kba_passed"; provider: string; providerReference: string | null; attemptId: string }
  | { type: "not_required_handwritten"; reviewedByUserId: string };

export type ElectronicSignature = { signatureType: "drawn" | "typed"; signatureData: string; signerName: string; taxpayerPin: string };
/** Where to stamp the signature on the form itself: page index and position as fractions from the top-left. */
export type SignaturePlacement = { page: number; xPct: number; yPct: number };

export class EfileSignatureError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 422 = 400, readonly code?: string) {
    super(message);
  }
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const KBA_PASS_WINDOW_MS = 15 * 60_000;

async function digest(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** Kept three years from the later of the return due date (April 15 of the next year) or the signing date. */
export function retentionUntil(taxYear: number, signedAt: Date): string {
  const due = Date.UTC(taxYear + 1, 3, 15);
  const base = new Date(Math.max(due, signedAt.getTime()));
  base.setUTCFullYear(base.getUTCFullYear() + 3);
  return base.toISOString().slice(0, 10);
}

export function validateTaxpayerPin(pin: string): string {
  const value = pin.trim();
  if (!/^\d{5}$/.test(value) || value === "00000") throw new EfileSignatureError("The taxpayer PIN must be five digits and cannot be all zeros.", 422);
  return value;
}

export function sniffContentType(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

export type EfileAuthorizationRow = {
  id: string; firm_id: string; client_id: string; signature_request_id: string; tax_return_id: string | null;
  tax_year: number; form_type: EfileFormType; taxpayer_role: TaxpayerRole; taxpayer_name: string; taxpayer_email: string | null;
  unsigned_r2_key: string; unsigned_hash: string; status: "awaiting_signature" | "handwritten_received" | "signed" | "voided";
  signed_method: EfileSigningMethod | null; received_r2_key: string | null; received_content_type: string | null;
  received_hash: string | null; received_at: string | null; received_ip: string | null; received_user_agent: string | null;
  kba_failed_attempts: number; created_at: string; voided_at: string | null; void_reason: string | null;
};

export async function getEfileAuthorization(db: Db, firmId: string, clientId: string, id: string): Promise<EfileAuthorizationRow> {
  const [row] = await db.query<EfileAuthorizationRow>(`SELECT * FROM efile_authorizations WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [id, firmId, clientId]);
  if (!row) throw new EfileSignatureError("E-file authorization not found.", 404);
  return row;
}

export async function listEfileAuthorizations(db: Db, firmId: string, clientId: string) {
  return db.query<EfileAuthorizationRow & { evidence: Record<string, unknown> | null }>(
    `SELECT ea.*, CASE WHEN ev.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', ev.id, 'method', ev.method, 'signatureType', ev.signature_type, 'signedAt', ev.signed_at,
        'signerName', ev.signer_name, 'signerIp', ev.signer_ip, 'signerLogin', ev.signer_login,
        'identityCheck', ev.identity_check, 'signedHash', ev.signed_hash, 'unsignedHash', ev.unsigned_hash,
        'retainUntil', ev.retain_until) END AS evidence
     FROM efile_authorizations ea
     LEFT JOIN efile_signature_evidence ev ON ev.authorization_id = ea.id
     WHERE ea.firm_id=$1 AND ea.client_id=$2
     ORDER BY ea.tax_year DESC, ea.created_at DESC`,
    [firmId, clientId],
  );
}

function auditStatement(firmId: string, clientId: string, event: string, actor: string, metadata: Record<string, unknown>) {
  return {
    query: `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
    params: [newId("aud"), firmId, clientId, event, actor, JSON.stringify(metadata)],
  };
}

export async function createEfileAuthorization(db: Db, env: Pick<Env, "RECEIPTS">, input: {
  firmId: string; clientId: string; userId: string; formType: EfileFormType; taxYear: number;
  taxReturnId?: string | null; taxpayerRole: TaxpayerRole; taxpayerName: string; taxpayerEmail?: string | null;
  formPdf: Uint8Array;
}): Promise<EfileAuthorizationRow> {
  if (input.formPdf.byteLength > MAX_UPLOAD_BYTES) throw new EfileSignatureError("The form PDF is larger than 15 MB.", 422);
  if (sniffContentType(input.formPdf) !== "application/pdf") throw new EfileSignatureError(`Upload the prepared Form ${input.formType} as a PDF.`, 422);
  await PDFDocument.load(input.formPdf).catch(() => { throw new EfileSignatureError("The PDF could not be read.", 422); });
  if (input.taxReturnId) {
    const [ret] = await db.query<{ tax_year: number }>(`SELECT tax_year FROM tax_returns WHERE id=$1 AND firm_id=$2 AND client_id=$3`, [input.taxReturnId, input.firmId, input.clientId]);
    if (!ret) throw new EfileSignatureError("Tax return not found for this client.", 404);
    if (Number(ret.tax_year) !== input.taxYear) throw new EfileSignatureError(`That return is for tax year ${ret.tax_year}, not ${input.taxYear}.`, 422);
  }

  const id = newId("efa");
  const requestId = newId("sigr");
  const unsignedHash = await digest(input.formPdf);
  const unsignedKey = `efile-authorizations/${input.firmId}/${input.clientId}/${id}/prepared-${unsignedHash.slice(0, 16)}.pdf`;
  await env.RECEIPTS.put(unsignedKey, input.formPdf, { httpMetadata: { contentType: "application/pdf" } });

  const email = input.taxpayerEmail?.trim().toLowerCase() || null;
  const recipients = email ? [{ name: input.taxpayerName.trim(), email, role: input.taxpayerRole }] : [];
  const [, [row]] = await db.transaction<any>([
    { query: `INSERT INTO signature_requests (id,firm_id,client_id,document_id,form_type,recipients) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      params: [requestId, input.firmId, input.clientId, id, input.formType, JSON.stringify(recipients)] },
    { query: `INSERT INTO efile_authorizations (id,firm_id,client_id,signature_request_id,tax_return_id,tax_year,form_type,
        taxpayer_role,taxpayer_name,taxpayer_email,unsigned_r2_key,unsigned_hash,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      params: [id, input.firmId, input.clientId, requestId, input.taxReturnId ?? null, input.taxYear, input.formType,
        input.taxpayerRole, input.taxpayerName.trim(), email, unsignedKey, unsignedHash, input.userId] },
    auditStatement(input.firmId, input.clientId, "efile_authorization_created", input.userId, { authorizationId: id, formType: input.formType, taxYear: input.taxYear, taxReturnId: input.taxReturnId ?? null }),
  ]);
  return row as EfileAuthorizationRow;
}

function assertOpen(auth: EfileAuthorizationRow) {
  if (auth.status === "signed") throw new EfileSignatureError("This authorization is already signed.", 409);
  if (auth.status === "voided") throw new EfileSignatureError("This authorization was voided. Prepare a new one.", 409);
}

async function loadObject(env: Pick<Env, "RECEIPTS">, key: string): Promise<Uint8Array> {
  const object = await env.RECEIPTS.get(key);
  if (!object) throw new EfileSignatureError("The stored form is no longer available.", 404);
  return new Uint8Array(await object.arrayBuffer());
}

export async function readPreparedForm(env: Pick<Env, "RECEIPTS">, auth: EfileAuthorizationRow) {
  return loadObject(env, auth.unsigned_r2_key);
}

/** A pen-signed copy arrives and waits for staff to confirm it is signed and dated. */
export async function receiveHandwrittenCopy(db: Db, env: Pick<Env, "RECEIPTS">, auth: EfileAuthorizationRow, input: {
  bytes: Uint8Array; ip: string | null; userAgent: string | null; actor: string;
}): Promise<EfileAuthorizationRow> {
  assertOpen(auth);
  if (input.bytes.byteLength === 0) throw new EfileSignatureError("The upload is empty.", 422);
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new EfileSignatureError("The upload is larger than 15 MB.", 422);
  const contentType = sniffContentType(input.bytes);
  if (!contentType) throw new EfileSignatureError("Upload a PDF, JPEG or PNG of the signed form.", 422);
  if (contentType === "application/pdf") await PDFDocument.load(input.bytes).catch(() => { throw new EfileSignatureError("The PDF could not be read.", 422); });
  const hash = await digest(input.bytes);
  const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";
  const key = `efile-authorizations/${auth.firm_id}/${auth.client_id}/${auth.id}/received-${hash.slice(0, 16)}.${extension}`;
  await env.RECEIPTS.put(key, input.bytes, { httpMetadata: { contentType } });
  const [[row]] = await db.transaction<any>([
    { query: `UPDATE efile_authorizations SET status='handwritten_received', received_r2_key=$1, received_content_type=$2,
        received_hash=$3, received_at=NOW(), received_ip=$4, received_user_agent=$5
        WHERE id=$6 AND status IN ('awaiting_signature','handwritten_received') RETURNING *`,
      params: [key, contentType, hash, input.ip, input.userAgent, auth.id] },
    auditStatement(auth.firm_id, auth.client_id, "efile_handwritten_received", input.actor, { authorizationId: auth.id, receivedHash: hash, contentType }),
  ]);
  if (!row) throw new EfileSignatureError("This authorization changed while uploading. Reload and try again.", 409);
  return row as EfileAuthorizationRow;
}

/** Staff confirm the received copy is signed and dated by the taxpayer, sealing it. */
export async function acceptHandwrittenCopy(db: Db, env: Pick<Env, "RECEIPTS">, auth: EfileAuthorizationRow, reviewerUserId: string) {
  if (auth.status !== "handwritten_received" || !auth.received_r2_key || !auth.received_hash) {
    throw new EfileSignatureError("No signed copy is waiting for review.", 409);
  }
  const received = await loadObject(env, auth.received_r2_key);
  if ((await digest(received)) !== auth.received_hash) throw new EfileSignatureError("The received copy failed its integrity check. Ask the taxpayer to upload it again.", 409);

  const isPdf = auth.received_content_type === "application/pdf";
  const doc = isPdf ? await PDFDocument.load(received) : await PDFDocument.create();
  if (!isPdf) {
    const image = auth.received_content_type === "image/png" ? await doc.embedPng(received) : await doc.embedJpg(received);
    const page = doc.addPage([612, 792]);
    const scale = Math.min(564 / image.width, 744 / image.height, 1);
    const width = image.width * scale; const height = image.height * scale;
    page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
  }
  return seal(db, env, auth, doc, {
    method: "handwritten_upload", signatureType: "handwritten_image", signerName: auth.taxpayer_name, taxpayerPin: null,
    signerIp: auth.received_ip, signerLogin: null, signerUserAgent: auth.received_user_agent,
    identityCheck: { type: "not_required_handwritten", reviewedByUserId: reviewerUserId }, recordedBy: reviewerUserId,
    receivedHash: auth.received_hash,
  });
}

export async function rejectHandwrittenCopy(db: Db, auth: EfileAuthorizationRow, reviewerUserId: string, reason: string) {
  if (auth.status !== "handwritten_received") throw new EfileSignatureError("No signed copy is waiting for review.", 409);
  await db.transaction([
    { query: `UPDATE efile_authorizations SET status='awaiting_signature', received_r2_key=NULL, received_content_type=NULL,
        received_hash=NULL, received_at=NULL, received_ip=NULL, received_user_agent=NULL WHERE id=$1 AND status='handwritten_received'`, params: [auth.id] },
    auditStatement(auth.firm_id, auth.client_id, "efile_handwritten_rejected", reviewerUserId, { authorizationId: auth.id, reason, receivedHash: auth.received_hash }),
  ]);
}

/** Prior-year signing evidence that used a real identity check establishes a multi-year relationship (p.16). */
export async function findMultiYearRelationship(db: Db, auth: EfileAuthorizationRow) {
  const [row] = await db.query<{ id: string; tax_year: number }>(
    `SELECT ev.id, ea.tax_year FROM efile_signature_evidence ev
     JOIN efile_authorizations ea ON ea.id = ev.authorization_id
     WHERE ea.firm_id=$1 AND ea.client_id=$2 AND ea.taxpayer_role=$3 AND ea.tax_year < $4
       AND ev.identity_check->>'type' IN ('photo_id_inspected','kba_passed')
     ORDER BY ea.tax_year DESC LIMIT 1`,
    [auth.firm_id, auth.client_id, auth.taxpayer_role, auth.tax_year],
  );
  return row ? { priorEvidenceId: row.id, priorTaxYear: Number(row.tax_year) } : null;
}

/** Taxpayer signs on the firm's device with the ERO physically present. */
export async function signInPerson(db: Db, env: Pick<Env, "RECEIPTS">, auth: EfileAuthorizationRow, input: {
  hostUserId: string; signature: ElectronicSignature; identity: { mode: "photo_id"; inspection: PhotoIdInspection } | { mode: "multi_year" };
  userAgent: string | null; placement?: SignaturePlacement | null;
}) {
  assertOpen(auth);
  const pin = validateTaxpayerPin(input.signature.taxpayerPin);
  let identityCheck: IdentityCheck;
  if (input.identity.mode === "multi_year") {
    const prior = await findMultiYearRelationship(db, auth);
    if (!prior) throw new EfileSignatureError("No prior-year signing with a verified ID exists for this taxpayer. Inspect a government photo ID instead.", 422);
    identityCheck = { type: "multi_year_relationship", ...prior };
  } else {
    const i = input.identity.inspection;
    if (i.photoMatchesTaxpayer !== true) throw new EfileSignatureError("Confirm the ID photo matches the taxpayer.", 422);
    if (!/^\d{4}$/.test(i.ssnLast4)) throw new EfileSignatureError("Record the last four digits of the SSN or ITIN.", 422);
    if (!/^[A-Za-z0-9]{4}$/.test(i.idNumberLast4)) throw new EfileSignatureError("Record the last four characters of the ID number.", 422);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.dateOfBirth)) throw new EfileSignatureError("Record the date of birth.", 422);
    if (!i.legalName.trim() || !i.address.trim()) throw new EfileSignatureError("Record the name and address shown on the ID.", 422);
    identityCheck = { type: "photo_id_inspected", inspectedByUserId: input.hostUserId, ...i, legalName: i.legalName.trim(), address: i.address.trim() };
  }
  const doc = await PDFDocument.load(await readPreparedForm(env, auth));
  return seal(db, env, auth, doc, {
    method: "in_person_esign", signatureType: input.signature.signatureType, signatureData: input.signature.signatureData,
    signerName: input.signature.signerName, taxpayerPin: pin, signerIp: null, signerLogin: null, signerUserAgent: input.userAgent,
    identityCheck, recordedBy: input.hostUserId, placement: input.placement ?? null,
  });
}

/** Records one KBA attempt. The third failure locks electronic signing for this authorization. */
export async function recordKbaAttempt(db: Db, auth: EfileAuthorizationRow, input: { provider: string; passed: boolean; providerReference: string | null }) {
  assertOpen(auth);
  if (auth.kba_failed_attempts >= KBA_MAX_ATTEMPTS) throw new EfileSignatureError("Identity verification failed three times. A handwritten signature is now required.", 409, "KBA_LOCKED");
  const attemptId = newId("kba");
  await db.transaction([
    { query: `INSERT INTO efile_kba_attempts (id, authorization_id, provider, outcome, provider_reference) VALUES ($1,$2,$3,$4,$5)`,
      params: [attemptId, auth.id, input.provider, input.passed ? "passed" : "failed", input.providerReference] },
    ...(input.passed ? [] : [{ query: `UPDATE efile_authorizations SET kba_failed_attempts = kba_failed_attempts + 1 WHERE id=$1`, params: [auth.id] }]),
  ]);
  const failed = auth.kba_failed_attempts + (input.passed ? 0 : 1);
  return { attemptId, passed: input.passed, attemptsRemaining: Math.max(0, KBA_MAX_ATTEMPTS - failed), locked: failed >= KBA_MAX_ATTEMPTS };
}

/** Remote electronic signature. Requires an enabled KBA vendor and a pass within the last 15 minutes. */
export async function signRemotelyAfterKba(db: Db, env: Pick<Env, "RECEIPTS" | "EFILE_KBA_PROVIDER" | "EFILE_KBA_API_KEY">, auth: EfileAuthorizationRow, input: {
  signature: ElectronicSignature; signerLogin: string; ip: string | null; userAgent: string | null;
}) {
  assertOpen(auth);
  const kba = resolveKbaProvider(env);
  if (!kba.enabled) throw new EfileSignatureError(`Remote e-signing is off: ${kba.reason} Use a pen signature upload or sign in the office.`, 409, "KBA_PROVIDER_DISABLED");
  const pin = validateTaxpayerPin(input.signature.taxpayerPin);
  const [attempt] = await db.query<{ id: string; provider: string; provider_reference: string | null; attempted_at: string }>(
    `SELECT id, provider, provider_reference, attempted_at FROM efile_kba_attempts WHERE authorization_id=$1 AND outcome='passed' ORDER BY attempted_at DESC LIMIT 1`, [auth.id]);
  if (!attempt || Date.now() - new Date(attempt.attempted_at).getTime() > KBA_PASS_WINDOW_MS) {
    throw new EfileSignatureError("Complete identity verification before signing.", 403, "KBA_REQUIRED");
  }
  const doc = await PDFDocument.load(await readPreparedForm(env, auth));
  return seal(db, env, auth, doc, {
    method: "remote_kba_esign", signatureType: input.signature.signatureType, signatureData: input.signature.signatureData,
    signerName: input.signature.signerName, taxpayerPin: pin, signerIp: input.ip, signerLogin: input.signerLogin, signerUserAgent: input.userAgent,
    identityCheck: { type: "kba_passed", provider: attempt.provider, providerReference: attempt.provider_reference, attemptId: attempt.id },
    recordedBy: null,
  });
}

type SealInput = {
  method: EfileSigningMethod; signatureType: "handwritten_image" | "drawn" | "typed"; signatureData?: string;
  signerName: string; taxpayerPin: string | null; signerIp: string | null; signerLogin: string | null; signerUserAgent: string | null;
  identityCheck: IdentityCheck; recordedBy: string | null; receivedHash?: string; placement?: SignaturePlacement | null;
};

const METHOD_LABEL: Record<EfileSigningMethod, string> = {
  handwritten_upload: "Handwritten signature, returned electronically",
  in_person_esign: "Electronic signature, in person with the ERO",
  remote_kba_esign: "Electronic signature, remote with identity verification",
};

function identityLines(check: IdentityCheck): string[] {
  switch (check.type) {
    case "photo_id_inspected":
      return [`Government photo ID inspected (${check.idType.replace(/_/g, " ")}, ending ${check.idNumberLast4}); photo matched taxpayer`,
        `Recorded: ${check.legalName}; SSN/ITIN ending ${check.ssnLast4}; DOB ${check.dateOfBirth}`, `Address: ${check.address}`];
    case "multi_year_relationship":
      return [`Multi-year relationship: identity verified for tax year ${check.priorTaxYear} (record ${check.priorEvidenceId})`];
    case "kba_passed":
      return [`Knowledge-based authentication passed (${check.provider}, reference ${check.providerReference ?? "n/a"})`];
    case "not_required_handwritten":
      return ["Not required: handwritten signature (Publication 1345, p.17)", `Signed copy reviewed by ${check.reviewedByUserId}`];
  }
}

/** Builds the sealed record: the form, the taxpayer signature (electronic methods), and a signing certificate page. */
async function seal(db: Db, env: Pick<Env, "RECEIPTS">, auth: EfileAuthorizationRow, doc: PDFDocument, input: SealInput) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const signedAt = new Date();
  const retainUntil = retentionUntil(auth.tax_year, signedAt);
  const evidenceId = newId("efev");
  const drawnPng = input.signatureType === "drawn"
    ? await (async () => {
        if (!input.signatureData?.startsWith("data:image/png;base64,")) throw new EfileSignatureError("Drawn signatures must be submitted as a PNG.", 422);
        return doc.embedPng(Uint8Array.from(atob(input.signatureData.slice(22)), (c) => c.charCodeAt(0)))
          .catch(() => { throw new EfileSignatureError("The drawn signature could not be read. Clear it and sign again.", 422); });
      })()
    : null;
  // Signature on the form itself, where the preparer placed it; the certificate page below still records it.
  if (input.placement && input.signatureType !== "handwritten_image") {
    const pages = doc.getPages();
    const target = pages[input.placement.page];
    if (!target) throw new EfileSignatureError("The signature placement is not on a page of this form.", 422);
    const { width, height } = target.getSize();
    const x = Math.min(Math.max(input.placement.xPct, 0), 1) * width;
    const y = height - Math.min(Math.max(input.placement.yPct, 0), 1) * height;
    if (drawnPng) {
      const scale = Math.min((width * 0.25) / drawnPng.width, 36 / drawnPng.height);
      target.drawImage(drawnPng, { x, y: y - drawnPng.height * scale, width: drawnPng.width * scale, height: drawnPng.height * scale });
    } else {
      target.drawText(`/${input.signerName}/`, { x, y: y - 12, size: 12, font: bold, color: rgb(0.08, 0.2, 0.45) });
    }
    target.drawText(`e-signed ${signedAt.toISOString().slice(0, 10)}`, { x, y: y - 44, size: 6.5, font, color: rgb(0.35, 0.35, 0.35) });
  }
  const page = doc.addPage([612, 792]);
  let y = 738;
  const line = (text: string, size = 9, useBold = false, gap = 14, color = rgb(0.15, 0.15, 0.15)) => {
    page.drawText(text.slice(0, 110), { x: 54, y, size, font: useBold ? bold : font, color });
    y -= gap;
  };
  const rule = () => { page.drawLine({ start: { x: 54, y: y + 6 }, end: { x: 558, y: y + 6 }, thickness: 0.75, color: rgb(0.8, 0.8, 0.8) }); y -= 10; };

  line(`TRUEPOST  |  IRS FORM ${auth.form_type} SIGNATURE RECORD`, 13, true, 20);
  line(`Record ${evidenceId}  |  Authorization ${auth.id}`, 8, false, 18, rgb(0.4, 0.4, 0.4));
  rule();
  line("TAXPAYER SIGNATURE", 10, true, 16);
  if (drawnPng) {
    const png = drawnPng;
    const scale = Math.min(220 / png.width, 60 / png.height, 1);
    page.drawImage(png, { x: 54, y: y - 50, width: png.width * scale, height: png.height * scale });
    y -= 64;
  } else if (input.signatureType === "typed") {
    line(`/${input.signerName}/`, 16, true, 26, rgb(0.08, 0.2, 0.45));
  } else {
    line("Handwritten signature appears on the attached signed form.", 9, false, 16);
  }
  line(`Signer: ${input.signerName} (${auth.taxpayer_role === "spouse" ? "spouse" : "taxpayer"})`);
  if (input.taxpayerPin) line(`Self-selected PIN entered as signature: ${input.taxpayerPin}`);
  line(`Signed: ${signedAt.toISOString()} UTC`);
  line(`Method: ${METHOD_LABEL[input.method]}`, 9, false, 18);
  rule();
  line("IDENTITY VERIFICATION", 10, true, 16);
  for (const text of identityLines(input.identityCheck)) line(text);
  y -= 4;
  rule();
  line("RECORD DATA (PUBLICATION 1345)", 10, true, 16);
  line(`Form ${auth.form_type}, tax year ${auth.tax_year}${auth.tax_return_id ? `, return ${auth.tax_return_id}` : ""}`);
  if (input.method === "remote_kba_esign") {
    line(`Signer IP address: ${input.signerIp ?? "unavailable"}`);
    line(`Signer login: ${input.signerLogin ?? "unavailable"}`);
  }
  line(`Prepared form SHA-256: ${auth.unsigned_hash}`, 8);
  if (input.receivedHash) line(`Received signed copy SHA-256: ${input.receivedHash}`, 8);
  line("Sealed-record SHA-256 is stored with the evidence record; Truepost verifies it on request.", 8);
  line(`Retain until: ${retainUntil}`, 9, false, 18);
  line("This record is append-only. Any change to this file changes its SHA-256 and fails verification.", 8, false, 12, rgb(0.4, 0.4, 0.4));

  const sealed = await doc.save();
  const signedHash = await digest(sealed);
  const signedKey = `efile-authorizations/${auth.firm_id}/${auth.client_id}/${auth.id}/signed-${signedHash.slice(0, 16)}.pdf`;
  await env.RECEIPTS.put(signedKey, sealed, { httpMetadata: { contentType: "application/pdf" } });

  // Claiming the authorization and writing its evidence happen in one statement,
  // so evidence can never exist for an authorization that was voided or already
  // signed. The follow-on writes only apply when that evidence row exists.
  const [[claimed]] = await db.transaction<any>([
    { query: `WITH claimed AS (
        UPDATE efile_authorizations SET status='signed', signed_method=$5
        WHERE id=$4 AND status IN ('awaiting_signature','handwritten_received') RETURNING id)
      INSERT INTO efile_signature_evidence (id, firm_id, client_id, authorization_id, method, signature_type, unsigned_hash,
        signed_hash, signed_r2_key, signer_name, taxpayer_pin, signer_ip, signer_login, signer_user_agent, identity_check,
        recorded_by_user_id, signed_at, retain_until)
      SELECT $1,$2,$3,claimed.id,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18 FROM claimed
      RETURNING id`,
      params: [evidenceId, auth.firm_id, auth.client_id, auth.id, input.method, input.signatureType, auth.unsigned_hash,
        signedHash, signedKey, input.signerName, input.taxpayerPin, input.signerIp, input.signerLogin, input.signerUserAgent,
        JSON.stringify(input.identityCheck), input.recordedBy, signedAt.toISOString(), retainUntil] },
    { query: `UPDATE signature_requests SET status='signed', signed_at=$1
        WHERE id=$2 AND EXISTS (SELECT 1 FROM efile_signature_evidence WHERE id=$3)`,
      params: [signedAt.toISOString(), auth.signature_request_id, evidenceId] },
    { query: `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
        SELECT $1,$2,$3,'efile_authorization_signed',$4,$5::jsonb,NOW() WHERE EXISTS (SELECT 1 FROM efile_signature_evidence WHERE id=$6)`,
      params: [newId("aud"), auth.firm_id, auth.client_id, input.recordedBy ?? input.signerLogin ?? "taxpayer",
        JSON.stringify({ authorizationId: auth.id, evidenceId, method: input.method, signedHash, retainUntil }), evidenceId] },
  ]);
  if (!claimed) throw new EfileSignatureError("This authorization was already signed or voided.", 409);
  return { evidenceId, signedHash, signedR2Key: signedKey, signedAt: signedAt.toISOString(), retainUntil };
}

/** Re-reads the sealed PDF and recomputes its SHA-256 against the append-only evidence record. */
export async function verifyEfileEvidence(db: Db, env: Pick<Env, "RECEIPTS">, auth: EfileAuthorizationRow) {
  const [ev] = await db.query<{ id: string; signed_hash: string; signed_r2_key: string }>(
    `SELECT id, signed_hash, signed_r2_key FROM efile_signature_evidence WHERE authorization_id=$1`, [auth.id]);
  if (!ev) throw new EfileSignatureError("This authorization has not been signed.", 409);
  const object = await env.RECEIPTS.get(ev.signed_r2_key);
  const actual = object ? await digest(new Uint8Array(await object.arrayBuffer())) : null;
  return { evidenceId: ev.id, intact: actual === ev.signed_hash, expectedHash: ev.signed_hash, actualHash: actual, checkedAt: new Date().toISOString() };
}

export async function readSealedRecord(db: Db, env: Pick<Env, "RECEIPTS">, auth: EfileAuthorizationRow) {
  const [ev] = await db.query<{ signed_r2_key: string }>(`SELECT signed_r2_key FROM efile_signature_evidence WHERE authorization_id=$1`, [auth.id]);
  if (!ev) throw new EfileSignatureError("This authorization has not been signed.", 409);
  return loadObject(env, ev.signed_r2_key);
}

export async function voidEfileAuthorization(db: Db, auth: EfileAuthorizationRow, userId: string, reason: string) {
  if (auth.status === "voided") throw new EfileSignatureError("Already voided.", 409);
  if (auth.tax_return_id) {
    const [ret] = await db.query<{ status: string }>(`SELECT status FROM tax_returns WHERE id=$1`, [auth.tax_return_id]);
    if (ret && ret.status !== "draft" && ret.status !== "rejected") throw new EfileSignatureError(`The return is ${ret.status}; its signed authorization must be kept.`, 409);
  }
  await db.transaction([
    { query: `UPDATE efile_authorizations SET status='voided', voided_at=NOW(), void_reason=$1 WHERE id=$2`, params: [reason, auth.id] },
    { query: `UPDATE signature_requests SET status='voided', voided_at=NOW(), void_reason=$1 WHERE id=$2 AND status <> 'signed'`, params: [reason, auth.signature_request_id] },
    auditStatement(auth.firm_id, auth.client_id, "efile_authorization_voided", userId, { authorizationId: auth.id, reason }),
  ]);
}

/**
 * Transmission gate (Publication 1345, software developer rule 9): a return
 * cannot be transmitted until its Form 8879 is signed by every taxpayer on it.
 */
export async function assertReturnSigned(db: Db, returnId: string): Promise<void> {
  const rows = await db.query<{ taxpayer_role: string; status: string }>(
    `SELECT taxpayer_role, status FROM efile_authorizations WHERE tax_return_id=$1 AND form_type='8879' AND status <> 'voided'`, [returnId]);
  if (!rows.length) throw new EfileSignatureError("Form 8879 has not been prepared for this return. Transmission is blocked until the taxpayer signs it.", 409, "EFILE_AUTHORIZATION_MISSING");
  const unsigned = rows.filter((r) => r.status !== "signed").map((r) => r.taxpayer_role);
  if (unsigned.length) throw new EfileSignatureError(`Form 8879 is not signed yet by: ${unsigned.join(", ")}. Transmission is blocked.`, 409, "EFILE_AUTHORIZATION_UNSIGNED");
}
