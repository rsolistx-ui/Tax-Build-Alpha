import type { Db } from "../db";
import { addRequestMessage } from "./request-messages";

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

export async function sendRemindersForFirm(db: Db, firmId: string, asOf: Date = new Date()): Promise<number> {
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

export async function handleReminderCron(env: { DATABASE_URL: string }): Promise<{ firms: number; remindersSent: number }> {
  const { createDb } = await import("../db");
  const db = createDb(env);

  const firms = await db.query<{ id: string }>(`SELECT id FROM firms`);
  let totalFirms = 0;
  let totalSent = 0;
  const asOf = new Date();

  for (const firm of firms) {
    const sent = await sendRemindersForFirm(db, firm.id, asOf);
    if (sent > 0) {
      totalFirms++;
      totalSent += sent;
    }
  }
  return { firms: totalFirms, remindersSent: totalSent };
}