import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";
import { generatePortalToken, hashPortalToken } from "./portal";

export type SigningAccess = {
  linkId: string; firmId: string; clientId: string; requestId: string;
  recipientEmail: string; recipientName: string | null; documentId: string;
  formType: string | null; filename: string; expiresAt: string;
};

export async function issueSigningAccessLink(db: Db, input: {
  firmId: string; clientId: string; requestId: string; recipientEmail: string;
  recipientName?: string | null; issuedByUserId: string; ttlHours?: number;
}): Promise<{ token: string; expiresAt: string }> {
  const prepared = await prepareSigningAccessLink(input);
  await db.transaction(prepared.statements);
  return { token: prepared.token, expiresAt: prepared.expiresAt };
}

/** Builds a new signing link. Delivery jobs can stage it without revoking a usable predecessor. */
export async function prepareSigningAccessLink(input: {
  firmId: string; clientId: string; requestId: string; recipientEmail: string;
  recipientName?: string | null; issuedByUserId: string; ttlHours?: number;
  /** Delivery retries stage a replacement first and revoke predecessors only after the recipient has it. */
  revokeExisting?: boolean;
}): Promise<{ token: string; expiresAt: string; linkId: string; statements: DbStatement[] }> {
  const token = generatePortalToken();
  const tokenHash = await hashPortalToken(token);
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? 168) * 3_600_000).toISOString();
  const email = input.recipientEmail.trim().toLowerCase();
  const linkId = newId("siglink");
  const statements: DbStatement[] = [];
  if (input.revokeExisting !== false) statements.push(
    // A staff-issued replacement cancels only an automatic reminder that has
    // not staged a bearer link. Once a reminder has staged one, we keep that
    // link valid through expiry: a stalled Worker may already hold its token.
    { query: `WITH cancelled AS (
         UPDATE operation_outbox
         SET status='cancelled', claim_token=NULL,
             last_error='Cancelled because a newer signing link was issued',
             provider_message_id='superseded_by_newer_signing_link', updated_at=NOW()
         WHERE operation_kind='signature_reminder'
           AND status IN ('pending','processing')
           AND NOT EXISTS (
             SELECT 1 FROM outbox_delivery_secrets s WHERE s.outbox_id=operation_outbox.id
           )
            AND payload->>'requestId'=$1
            AND LOWER(payload->>'taxpayerEmail')=LOWER($2)
          RETURNING id
        )
        UPDATE signature_access_links SET revoked_at=NOW()
       WHERE signature_request_id=$1 AND LOWER(recipient_email)=LOWER($2)
         AND revoked_at IS NULL AND consumed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM outbox_delivery_secrets s
           WHERE s.signing_link_id=signature_access_links.id
         )`, params: [input.requestId, email] },
  );
  statements.push(
    { query: `INSERT INTO signature_access_links
       (id,firm_id,client_id,signature_request_id,recipient_email,recipient_name,token_hash,expires_at,issued_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, params: [linkId, input.firmId, input.clientId, input.requestId, email, input.recipientName ?? null, tokenHash, expiresAt, input.issuedByUserId] },
  );
  return { token, expiresAt, linkId, statements };
}

export async function resolveSigningAccess(db: Db, token: string): Promise<SigningAccess | null> {
  const hash = await hashPortalToken(token);
  const [row] = await db.query<any>(`SELECT sal.id AS link_id, sal.firm_id, sal.client_id, sal.signature_request_id,
      sal.recipient_email, sal.recipient_name, sal.expires_at, sr.document_id, sr.form_type,
      COALESCE(cd.filename, sr.form_type || 'Document.pdf') AS filename
    FROM signature_access_links sal
    JOIN signature_requests sr ON sr.id=sal.signature_request_id AND sr.firm_id=sal.firm_id AND sr.client_id=sal.client_id
    LEFT JOIN client_documents cd ON cd.id=sr.document_id AND cd.client_id=sal.client_id
    WHERE sal.token_hash=$1 AND sal.revoked_at IS NULL AND sal.consumed_at IS NULL
      AND sal.expires_at > NOW() AND sr.status IN ('pending','sent')`, [hash]);
  if (!row?.document_id) return null;
  return { linkId: row.link_id, firmId: row.firm_id, clientId: row.client_id, requestId: row.signature_request_id,
    recipientEmail: row.recipient_email, recipientName: row.recipient_name, documentId: row.document_id,
    formType: row.form_type, filename: row.filename, expiresAt: row.expires_at };
}

export async function claimSigningAccess(db: Db, linkId: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(`UPDATE signature_access_links SET claimed_at=NOW()
    WHERE id=$1 AND claimed_at IS NULL AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() RETURNING id`, [linkId]);
  return rows.length === 1;
}

export async function releaseSigningAccess(db: Db, linkId: string): Promise<void> {
  await db.query(`UPDATE signature_access_links SET claimed_at=NULL WHERE id=$1 AND consumed_at IS NULL`, [linkId]);
}

export async function consumeSigningAccess(db: Db, linkId: string): Promise<void> {
  await db.query(`UPDATE signature_access_links SET consumed_at=NOW() WHERE id=$1 AND claimed_at IS NOT NULL AND consumed_at IS NULL`, [linkId]);
}
