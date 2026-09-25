import type { Db } from "../db";
import { newId } from "../lib/id";
import { toFirmRole, type FirmRole } from "./firm-roles";

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

/** The caller's role in their firm, or null when they belong to none yet. */
export async function getFirmMembership(db: Db, userId: string): Promise<{ firmId: string; role: FirmRole } | null> {
  const [row] = await db.query<{ firm_id: string; role: string }>(
    `SELECT firm_id, role FROM firm_members WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (!row) return null;
  return { firmId: row.firm_id, role: toFirmRole(row.role) };
}

export type AccessEntitlement = {
  status: string;
  starts_at: string;
  expires_at: string;
  /** "own": the user's entitlement. "firm": a staff member using their firm owner's. */
  source: "own" | "firm";
};

/**
 * The entitlement that governs a user's access and their firm role, in one
 * query: their own entitlement when they have one, otherwise (staff only)
 * their firm owner's, so a staff seat lives and ends with the firm's plan.
 * A user with no firm yet is treated as an owner (ensureFirm makes them one).
 */
export async function loadAccessEntitlement(
  db: Db,
  userId: string,
): Promise<{ entitlement: AccessEntitlement | null; role: FirmRole; seesAllClients: boolean }> {
  const [row] = await db.query<{
    role: string | null;
    sees_all_clients: boolean | null;
    own_status: string | null; own_starts: string | null; own_expires: string | null;
    firm_status: string | null; firm_starts: string | null; firm_expires: string | null;
  }>(
    `SELECT m.role, m.sees_all_clients,
            own.status AS own_status, own.starts_at AS own_starts, own.expires_at AS own_expires,
            fe.status AS firm_status, fe.starts_at AS firm_starts, fe.expires_at AS firm_expires
       FROM (SELECT $1::text AS uid) u
       LEFT JOIN beta_entitlements own ON own.user_id = u.uid
       LEFT JOIN firm_members m ON m.user_id = u.uid
       LEFT JOIN firms f ON f.id = m.firm_id
       LEFT JOIN beta_entitlements fe ON fe.user_id = f.owner_user_id AND m.role <> 'owner'`,
    [userId],
  );
  const role = row?.role ? toFirmRole(row.role) : "owner";
  const seesAllClients = role === "owner" || row?.sees_all_clients === true;
  if (row?.own_status) {
    return { role, seesAllClients, entitlement: { status: row.own_status, starts_at: row.own_starts!, expires_at: row.own_expires!, source: "own" } };
  }
  if (row?.firm_status) {
    return { role, seesAllClients, entitlement: { status: row.firm_status, starts_at: row.firm_starts!, expires_at: row.firm_expires!, source: "firm" } };
  }
  return { role, seesAllClients, entitlement: null };
}
