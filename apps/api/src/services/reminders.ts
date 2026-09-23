import type { Db } from "../db";
import { addRequestMessage } from "./request-messages";
import { sendEmail } from "./signature-reminders";

type EmailEnv = { RESEND_API_KEY?: string; SENDER_EMAIL?: string };

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
    await addRequestMessage(
      db,
      request.id,
      request.firm_id,
      request.client_id,
      "system",
      null,
      `Reminder: ${request.title} is awaiting your response.${request.due_at ? ` Due ${new Date(request.due_at).toLocaleDateString()}.` : ""}`,
    );
    // Email the client too when email is configured; the portal message above is always posted.
    if (emailEnv?.RESEND_API_KEY) {
      const [who] = await db.query<{ email: string | null; client_name: string; firm_name: string }>(
        `SELECT c.email, COALESCE(c.legal_name, c.name) AS client_name, f.name AS firm_name FROM clients c JOIN firms f ON f.id = c.firm_id WHERE c.id = $1 AND c.firm_id = $2`,
        [request.client_id, firmId],
      );
      if (who?.email) {
        const due = request.due_at ? ` It is due ${new Date(request.due_at).toLocaleDateString("en-US")}.` : "";
        await sendEmail(emailEnv, {
          to: who.email, fromName: who.firm_name,
          subject: `${who.firm_name}: reminder, ${request.title}`,
          text: `Hello ${who.client_name},

This is a reminder that we are waiting on: ${request.title}.${due} Please respond through the secure client link we sent you, or reply to this email.

${who.firm_name}`,
          html: `<p>Hello ${who.client_name.replace(/</g, "&lt;")},</p><p>This is a reminder that we are waiting on: <strong>${request.title.replace(/</g, "&lt;")}</strong>.${due} Please respond through the secure client link we sent you, or reply to this email.</p><p>${who.firm_name.replace(/</g, "&lt;")}</p>`,
        }).catch(() => false);
      }
    }

    // Exponential backoff: 5d, 10d, 20d, 40d... cap at 30 days
    const nextDelay = Math.min(DEFAULT_REMINDER_DELAY_DAYS * (2 ** request.reminder_count), 30);
    const nextReminderAt = new Date(asOf.getTime() + nextDelay * 24 * 60 * 60 * 1000);

    await db.query(
      `UPDATE client_requests SET reminder_count = reminder_count + 1, last_reminded_at = NOW(), next_reminder_at = $1, updated_at = NOW() WHERE id = $2 AND firm_id = $3`,
      [nextReminderAt.toISOString(), request.id, firmId],
    );
    sent++;
  }
  return sent;
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