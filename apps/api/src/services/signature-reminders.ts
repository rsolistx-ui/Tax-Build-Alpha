import type { Db } from "../db";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { prepareSigningAccessLink } from "./signature-access";
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
  const due = await db.query<{ id: string; firm_id: string; client_id: string; signature_request_id: string; form_type: string; tax_year: number; taxpayer_name: string; taxpayer_email: string; firm_name: string; links: string }>(
    `SELECT ea.id, ea.firm_id, ea.client_id, ea.signature_request_id, ea.form_type, ea.tax_year, ea.taxpayer_name, ea.taxpayer_email, f.name AS firm_name,
            (SELECT COUNT(*) FROM signature_access_links l WHERE l.signature_request_id = ea.signature_request_id)::text AS links
     FROM efile_authorizations ea JOIN firms f ON f.id = ea.firm_id
     WHERE ea.status = 'awaiting_signature' AND ea.taxpayer_email IS NOT NULL
       AND EXISTS (SELECT 1 FROM signature_access_links l WHERE l.signature_request_id = ea.signature_request_id)
       AND NOT EXISTS (SELECT 1 FROM signature_access_links l WHERE l.signature_request_id = ea.signature_request_id AND l.created_at > NOW() - make_interval(days => ${REMIND_EVERY_DAYS}))
     LIMIT 50`,
  );
  const origin = env.APP_ORIGIN || env.BETTER_AUTH_URL;
  let sent = 0;
  for (const row of due) {
    if (Number(row.links) >= MAX_LINKS) continue;
    const link = await prepareSigningAccessLink({ firmId: row.firm_id, clientId: row.client_id, requestId: row.signature_request_id, recipientEmail: row.taxpayer_email, recipientName: row.taxpayer_name, issuedByUserId: "system:signature-reminder" });
    const url = `${origin}/sign#token=${encodeURIComponent(link.token)}`;
    const subject = `${row.firm_name}: your Form ${row.form_type} for ${row.tax_year} is waiting for your signature`;
    const text = `Hello ${row.taxpayer_name},\n\nYour Form ${row.form_type} for tax year ${row.tax_year} still needs your signature before your return can be filed. Download it, sign and date it by hand, and upload a photo:\n\n${url}\n\nThis new link replaces earlier ones and expires in 7 days.\n\n${row.firm_name}`;
    const html = `<p>Hello ${esc(row.taxpayer_name)},</p><p>Your Form ${esc(row.form_type)} for tax year ${row.tax_year} still needs your signature before your return can be filed. Download it, sign and date it by hand, and upload a photo.</p><p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;background:#0b3b91;color:#fff;border-radius:6px;text-decoration:none">Sign your form</a></p><p>This new link replaces earlier ones and expires in 7 days.</p><p>${esc(row.firm_name)}</p>`;
    await db.transaction([
      ...link.statements,
      ...enqueueOutboxStatements({
        firmId: row.firm_id,
        ticketNumber: `signature-reminder:${row.id}:${Number(row.links) + 1}`,
        operations: [{
          kind: "prepared_email",
          key: "taxpayer-email",
          payload: { to: row.taxpayer_email, subject, text, html, ticketNumber: `signature-reminder:${row.id}` },
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
