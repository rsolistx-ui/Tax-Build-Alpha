import { newId } from "../lib/id";
import type { Db } from "../db";
import { workAuditEventStatement } from "./work-audit";

const TOKEN_BYTES = 32;

export function generatePortalToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashPortalToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PortalLinkRow = {
  id: string;
  firm_id: string;
  client_id: string;
  expires_at: string;
  revoked_at: string | null;
};

/**
 * Issues a new hashed, expiring portal link for one client. Only the
 * plaintext token is ever returned to the caller; only its hash is
 * persisted, mirroring the existing beta-invitation token pattern.
 */
export async function createPortalLink(
  db: Db,
  firmId: string,
  clientId: string,
  createdByUserId: string,
  ttlDays = 30,
): Promise<{ id: string; token: string; expiresAt: string }> {
  const id = newId("plink");
  const token = generatePortalToken();
  const tokenHash = await hashPortalToken(token);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  await db.transaction([
    {
      query: `INSERT INTO client_portal_links (id, firm_id, client_id, token_hash, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      params: [id, firmId, clientId, tokenHash, createdByUserId, expiresAt],
    },
    workAuditEventStatement({
      firmId,
      entityType: "client_portal_link",
      entityId: id,
      action: "portal_link_created",
      actorUserId: createdByUserId,
      afterJson: { clientId, expiresAt },
    }),
  ]);

  return { id, token, expiresAt };
}

/**
 * Resolves a presented portal token to its (firmId, clientId), or null if
 * the token is unknown, revoked, or expired. Never trusts a client-supplied
 * firmId or clientId elsewhere - this is the only place those values may
 * originate for a portal-authenticated request.
 */
export async function resolvePortalToken(
  db: Db,
  token: string,
): Promise<{ firmId: string; clientId: string; linkId: string } | null> {
  const tokenHash = await hashPortalToken(token);
  const [link] = await db.query<PortalLinkRow>(
    `SELECT id, firm_id, client_id, expires_at, revoked_at FROM client_portal_links WHERE token_hash = $1`,
    [tokenHash],
  );
  if (!link) return null;
  if (link.revoked_at) return null;
  if (new Date(link.expires_at).getTime() < Date.now()) return null;

  await db.query(`UPDATE client_portal_links SET last_used_at = NOW() WHERE id = $1`, [link.id]);
  return { firmId: link.firm_id, clientId: link.client_id, linkId: link.id };
}

export async function revokePortalLink(db: Db, linkId: string, firmId: string, actorUserId: string | null = null): Promise<boolean> {
  // One CTE-chained statement: the audit INSERT only runs when the
  // UPDATE actually revoked an active link, atomically with the revoke
  // itself.
  const rows = await db.query<{ id: string }>(
    `WITH revoked AS (
       UPDATE client_portal_links SET revoked_at = NOW() WHERE id = $1 AND firm_id = $2 AND revoked_at IS NULL
       RETURNING id
     )
     INSERT INTO work_audit_events (id, firm_id, entity_type, entity_id, action, actor_user_id, after_json)
     SELECT $3, $2, 'client_portal_link', $1, 'portal_link_revoked', $4, '{}'::jsonb
     FROM revoked
     RETURNING id`,
    [linkId, firmId, newId("wae"), actorUserId],
  );
  return rows.length > 0;
}
