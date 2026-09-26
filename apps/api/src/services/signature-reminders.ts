import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { enqueueOutboxStatements } from "./durable-outbox";

/** Sends one email through Resend. Returns false (and sends nothing) when email is not configured. */
export async function sendEmail(env: Pick<Env, "RESEND_API_KEY" | "SENDER_EMAIL" | "REPLY_TO_EMAIL">, message: { to: string; fromName: string; subject: string; text: string; html: string }, deps: { fetch?: typeof fetch } = {}): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const response = await (deps.fetch ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.SENDER_EMAIL || `${message.fromName} <onboarding@resend.dev>`, to: [message.to], reply_to: env.REPLY_TO_EMAIL || undefined, subject: message.subject, text: message.text, html: message.html }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const REMIND_EVERY_DAYS = 3;
const MAX_LINKS = 6; // the first link plus five reminders

/**
 * Form 8879/8878 still unsigned three days after the last signing link: email a fresh
 * link (which replaces the old one). Stops after five reminders so clients are not spammed.
 */
export async function runSignatureReminders(db: Db, env: Env, deps: { fetch?: typeof fetch } = {}) {
  if (!env.RESEND_API_KEY) return { sent: 0, skipped: "email_not_configured" as const };
  // Do not create an automatic reminder we cannot safely resume after a
  // Worker restart. Existing rows remain visible in the durable outbox.
  if (!env.OUTBOX_DELIVERY_KEY_V1) return { sent: 0, skipped: "delivery_encryption_not_configured" as const };
  const due = await db.query<{ id: string; firm_id: string; client_id: string; signature_request_id: string; form_type: string; tax_year: number; taxpayer_name: string; taxpayer_email: string; firm_name: string; links: string }>(
    `SELECT ea.id, ea.firm_id, ea.client_id, ea.signature_request_id, ea.form_type, ea.tax_year, ea.taxpayer_name, ea.taxpayer_email, f.name AS firm_name,
            (SELECT COUNT(*) FROM signature_access_links l WHERE l.signature_request_id = ea.signature_request_id)::text AS links
     FROM efile_authorizations ea JOIN firms f ON f.id = ea.firm_id
     WHERE ea.status = 'awaiting_signature' AND ea.taxpayer_email IS NOT NULL
       AND EXISTS (SELECT 1 FROM signature_access_links l WHERE l.signature_request_id = ea.signature_request_id)
       AND NOT EXISTS (SELECT 1 FROM signature_access_links l WHERE l.signature_request_id = ea.signature_request_id AND l.created_at > NOW() - make_interval(days => ${REMIND_EVERY_DAYS}))
     LIMIT 50`,
  );
  let sent = 0;
  for (const row of due) {
    if (Number(row.links) >= MAX_LINKS) continue;
    await db.transaction([
      ...enqueueOutboxStatements({
        firmId: row.firm_id,
        ticketNumber: `signature-reminder:${row.id}:${Number(row.links) + 1}`,
        operations: [{
          kind: "signature_reminder",
          key: "taxpayer-email",
          payload: { authorizationId: row.id, firmId: row.firm_id, clientId: row.client_id, requestId: row.signature_request_id, taxpayerName: row.taxpayer_name, taxpayerEmail: row.taxpayer_email, firmName: row.firm_name, formType: row.form_type, taxYear: row.tax_year },
        }],
      }),
      {
        query: `INSERT INTO audit_events (id, firm_id, client_id, event, actor_user_id, metadata, created_at)
                VALUES ($1,$2,$3,'efile_signature_reminder_queued',$4,$5::jsonb,NOW())`,
        params: [newId("aud"), row.firm_id, row.client_id, "system:signature-reminder", { authorizationId: row.id, deliveryQueued: true }],
      },
    ]);
    sent++;
  }
  return { sent, skipped: null };
}
