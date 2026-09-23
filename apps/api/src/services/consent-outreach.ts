import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { activeDocumentReaders } from "../providers/llm";
import { consentRequired, createConsentRequest } from "./taxpayer-consent";

/**
 * Collects the IRC § 7216 disclosure consent without staff effort: every morning,
 * active clients with an email who have no current consent (or one expiring within
 * 30 days) receive a signing link. One link per client per week at most. Nothing is
 * sent when US-only reading is on, because no consent is needed then.
 */
const MAX_PER_RUN = 50; // stays under Resend's free-tier daily limit
const RESEND_DAYS = 7;

export function consentEmail(firmName: string, clientName: string, url: string) {
  const subject = `${firmName}: please review a short privacy form`;
  const text = `Hello ${clientName},\n\nBefore we can read your receipts automatically, federal law requires your written consent. The form takes about a minute:\n\n${url}\n\nYou are not required to sign. If you do not, we will enter your documents by hand. The link expires in 14 days.\n\n${firmName}`;
  const html = `<p>Hello ${escape(clientName)},</p><p>Before we can read your receipts automatically, federal law requires your written consent. The form takes about a minute.</p><p><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;background:#0b3b91;color:#fff;border-radius:6px;text-decoration:none">Review the form</a></p><p>You are not required to sign. If you do not, we will enter your documents by hand. The link expires in 14 days.</p><p>${escape(firmName)}</p>`;
  return { subject, text, html };
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export async function clientsNeedingConsent(db: Db, readerIds: string[], firmId?: string) {
  const required = JSON.stringify(["truepost", ...readerIds]);
  return db.query<{ client_id: string; firm_id: string; client_name: string; email: string; firm_name: string }>(
    `SELECT c.id AS client_id, c.firm_id, COALESCE(c.legal_name, c.name) AS client_name, c.email, f.name AS firm_name
     FROM clients c JOIN firms f ON f.id = c.firm_id
     WHERE c.email IS NOT NULL AND c.email <> '' AND c.pipeline_status IN ('engaged','active')
       AND ($2::text IS NULL OR c.firm_id = $2)
       AND NOT EXISTS (
         SELECT 1 FROM taxpayer_consents t WHERE t.client_id = c.id AND t.consent_kind = 'disclosure_document_reading'
           AND t.revoked_at IS NULL AND t.expires_on > CURRENT_DATE + 30 AND t.recipients @> $1::jsonb)
       AND NOT EXISTS (
         SELECT 1 FROM consent_requests r WHERE r.client_id = c.id AND r.created_at > NOW() - make_interval(days => ${RESEND_DAYS}))
     ORDER BY c.created_at
     LIMIT ${MAX_PER_RUN}`,
    [required, firmId ?? null],
  );
}

export type ConsentOutreachResult = { status: "not_required" | "email_not_configured" | "sent"; sent: number; waiting: number };

export async function runConsentOutreach(db: Db, env: Env, deps: { fetch?: typeof fetch } = {}): Promise<ConsentOutreachResult> {
  const readers = activeDocumentReaders(env);
  if (!consentRequired(readers)) return { status: "not_required", sent: 0, waiting: 0 };
  const due = await clientsNeedingConsent(db, readers.map((r) => r.id));
  if (!env.RESEND_API_KEY) return { status: "email_not_configured", sent: 0, waiting: due.length };

  const doFetch = deps.fetch ?? fetch;
  const origin = env.APP_ORIGIN || env.BETTER_AUTH_URL;
  let sent = 0;
  for (const row of due) {
    const link = await createConsentRequest(db, row.firm_id, row.client_id, "system:consent-outreach");
    const url = `${origin}/consent#token=${encodeURIComponent(link.token)}`;
    const message = consentEmail(row.firm_name, row.client_name, url);
    const response = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.SENDER_EMAIL || `${row.firm_name} <onboarding@resend.dev>`, to: [row.email], reply_to: env.REPLY_TO_EMAIL || undefined, ...message }),
    }).catch(() => null);
    const delivered = Boolean(response?.ok);
    if (delivered) sent++;
    await db.query(
      `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at) VALUES ($1,$2,$3,'consent_link_emailed',$4,$5::jsonb,NOW())`,
      [newId("aud"), row.firm_id, row.client_id, "system:consent-outreach", JSON.stringify({ delivered, status: response?.status ?? null, expiresAt: link.expiresAt })],
    );
  }
  return { status: "sent", sent, waiting: due.length - sent };
}
