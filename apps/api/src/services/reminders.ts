import type { Db } from "../db";
import { newId } from "../lib/id";

type EmailEnv = { RESEND_API_KEY?: string; SENDER_EMAIL?: string; REPLY_TO_EMAIL?: string };

const DEFAULT_REMINDER_DELAY_DAYS = 5;

export function nextReminderAfterSend(from: Date = new Date()): Date {
  return new Date(from.getTime() + DEFAULT_REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000);
}

export async function listRequestsDueForReminder(db: Db, firmId: string, asOf: Date = new Date()): Promise<import("./client-requests").ClientRequestRow[]> {
  return db.query<import("./client-requests").ClientRequestRow>(
    `SELECT * FROM client_requests WHERE firm_id = $1 AND status IN ('requested', 'viewed') AND next_reminder_at IS NOT NULL AND next_reminder_at <= $2 ORDER BY next_reminder_at ASC`,
    [firmId, asOf.toISOString()],
  );
}

export async function sendRemindersForFirm(db: Db, firmId: string, asOf: Date = new Date(), emailEnv?: EmailEnv): Promise<number> {
  const due = await listRequestsDueForReminder(db, firmId, asOf);
  if (due.length === 0) return 0;

  let sent = 0;
  for (const request of due) {
    const reminderText = `Reminder: ${request.title} is awaiting your response.${request.due_at ? ` Due ${new Date(request.due_at).toLocaleDateString()}.` : ""}`;
    let emailPayload: Record<string, unknown> | null = null;
    // Build delivery intent before committing the portal message and reminder schedule.
    if (emailEnv?.RESEND_API_KEY) {
      const [who] = await db.query<{ email: string | null; client_name: string; firm_name: string }>(
        `SELECT c.email, COALESCE(c.legal_name, c.name) AS client_name, f.name AS firm_name FROM clients c JOIN firms f ON f.id = c.firm_id WHERE c.id = $1 AND c.firm_id = $2`,
        [request.client_id, firmId],
      );
      if (who?.email) {
        const due = request.due_at ? ` It is due ${new Date(request.due_at).toLocaleDateString("en-US")}.` : "";
        const subject = `${who.firm_name}: reminder, ${request.title}`;
        const text = `Hello ${who.client_name},

This is a reminder that we are waiting on: ${request.title}.${due} Please respond through the secure client link we sent you, or reply to this email.

${who.firm_name}`;
        emailPayload = {
          to: who.email, subject, text,
          html: `<p>Hello ${escapeHtml(who.client_name)},</p><p>This is a reminder that we are waiting on: <strong>${escapeHtml(request.title)}</strong>.${due} Please respond through the secure client link we sent you, or reply to this email.</p><p>${escapeHtml(who.firm_name)}</p>`,
          ticketNumber: `request-reminder:${request.id}`,
        };
      }
    }

    // Exponential backoff: 5d, 10d, 20d, 40d... cap at 30 days
    const nextDelay = Math.min(DEFAULT_REMINDER_DELAY_DAYS * (2 ** request.reminder_count), 30);
    const nextReminderAt = new Date(asOf.getTime() + nextDelay * 24 * 60 * 60 * 1000);

    const claimed = await db.query<{ id: string }>(
      `WITH claimed AS (
         UPDATE client_requests SET reminder_count = reminder_count + 1, last_reminded_at = NOW(), next_reminder_at = $1, updated_at = NOW()
         WHERE id = $2 AND firm_id = $3 AND status IN ('requested', 'viewed') AND next_reminder_at IS NOT NULL AND next_reminder_at <= $4
         RETURNING id, firm_id, client_id
       ), message AS (
         INSERT INTO request_messages (id, firm_id, request_id, client_id, author_type, author_user_id, body)
         SELECT $5, firm_id, id, client_id, 'system', NULL, $6 FROM claimed
       ), outbox AS (
         INSERT INTO operation_outbox (id, firm_id, operation_kind, payload, idempotency_key)
         SELECT $7, firm_id, 'prepared_email', $8::jsonb, $9 FROM claimed WHERE $10::boolean
         ON CONFLICT (idempotency_key) DO NOTHING
       ) SELECT id FROM claimed`,
      [nextReminderAt.toISOString(), request.id, firmId, asOf.toISOString(), newId("rmsg"), reminderText, newId("outbox"), emailPayload, `request-reminder:${request.id}:${request.reminder_count + 1}:client-email`, Boolean(emailPayload)],
    );
    if (claimed.length) sent++;
  }
  return sent;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export async function handleReminderCron(env: { DATABASE_URL: string } & EmailEnv): Promise<{ firms: number; remindersSent: number }> {
  const { createDb } = await import("../db");
  const db = createDb(env);

  const firms = await db.query<{ id: string }>(`SELECT id FROM firms`);
  let totalFirms = 0;
  let totalSent = 0;
  const asOf = new Date();

  for (const firm of firms) {
    const sent = await sendRemindersForFirm(db, firm.id, asOf, env);
    if (sent > 0) {
      totalFirms++;
      totalSent += sent;
    }
  }
  return { firms: totalFirms, remindersSent: totalSent };
}
