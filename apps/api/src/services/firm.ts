import type { Env } from "../env";
import { newId } from "../lib/id";

/** Ensure the user has a firm; create a default practice on first access. */
export async function ensureFirm(db: D1Database, userId: string, userName: string) {
  const existing = await db
    .prepare(
      `SELECT f.* FROM firms f
       JOIN firm_members m ON m.firm_id = f.id
       WHERE m.user_id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string; name: string; owner_user_id: string }>();

  if (existing) return existing;

  const firmId = newId("firm");
  const memberId = newId("fm");
  const firmName = `${userName}'s Firm`;

  await db.batch([
    db
      .prepare(
        `INSERT INTO firms (id, name, owner_user_id) VALUES (?, ?, ?)`,
      )
      .bind(firmId, firmName, userId),
    db
      .prepare(
        `INSERT INTO firm_members (id, firm_id, user_id, role) VALUES (?, ?, ?, 'owner')`,
      )
      .bind(memberId, firmId, userId),
  ]);

  return { id: firmId, name: firmName, owner_user_id: userId };
}

export async function getFirmForUser(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT f.* FROM firms f
       JOIN firm_members m ON m.firm_id = f.id
       WHERE m.user_id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string; name: string; owner_user_id: string }>();
}
