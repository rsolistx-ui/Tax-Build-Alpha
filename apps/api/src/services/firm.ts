import type { Db } from "../db";
import { newId } from "../lib/id";

export type FirmRow = {
  id: string;
  name: string;
  owner_user_id: string;
};

/** Ensure the authenticated user has a firm in Neon. */
export async function ensureFirm(db: Db, userId: string, userName: string): Promise<FirmRow> {
  const [existing] = await db.query<FirmRow>(
    `SELECT f.id, f.name, f.owner_user_id
     FROM firms f
     JOIN firm_members m ON m.firm_id = f.id
     WHERE m.user_id = $1
     LIMIT 1`,
    [userId],
  );

  if (existing) return existing;

  const firmId = newId("firm");
  const memberId = newId("fm");
  const firmName = `${userName || "Owner"}'s Firm`;

  await db.transaction([
    {
      query: `INSERT INTO firms (id, name, owner_user_id) VALUES ($1, $2, $3)`,
      params: [firmId, firmName, userId],
    },
    {
      query: `INSERT INTO firm_members (id, firm_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
      params: [memberId, firmId, userId],
    },
  ]);

  return { id: firmId, name: firmName, owner_user_id: userId };
}

export async function getFirmForUser(db: Db, userId: string): Promise<FirmRow | undefined> {
  const [firm] = await db.query<FirmRow>(
    `SELECT f.id, f.name, f.owner_user_id
     FROM firms f
     JOIN firm_members m ON m.firm_id = f.id
     WHERE m.user_id = $1
     LIMIT 1`,
    [userId],
  );
  return firm;
}
