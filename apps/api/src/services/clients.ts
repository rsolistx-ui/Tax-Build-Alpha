import type { Env } from "../env";
import { DEFAULT_CATEGORIES } from "../lib/defaults";
import { newId } from "../lib/id";

export async function listClients(db: D1Database, firmId: string) {
  const { results } = await db
    .prepare(
      `SELECT id, firm_id, name, legal_name, notes, created_at, updated_at
       FROM clients WHERE firm_id = ? ORDER BY name COLLATE NOCASE`,
    )
    .bind(firmId)
    .all();
  return results ?? [];
}

export async function getClient(db: D1Database, clientId: string, firmId: string) {
  return db
    .prepare(`SELECT * FROM clients WHERE id = ? AND firm_id = ?`)
    .bind(clientId, firmId)
    .first();
}

export async function createClient(
  db: D1Database,
  firmId: string,
  input: { name: string; legal_name?: string; notes?: string },
) {
  const id = newId("cli");
  await db
    .prepare(
      `INSERT INTO clients (id, firm_id, name, legal_name, notes) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, firmId, input.name, input.legal_name ?? null, input.notes ?? null)
    .run();

  // Seed default category folders
  const stmts = DEFAULT_CATEGORIES.map((c) =>
    db
      .prepare(
        `INSERT INTO categories (id, client_id, name, slug, is_default, sort_order)
         VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .bind(newId("cat"), id, c.name, c.slug, c.sort_order),
  );
  await db.batch(stmts);

  return getClient(db, id, firmId);
}

export async function updateClient(
  db: D1Database,
  clientId: string,
  firmId: string,
  input: { name?: string; legal_name?: string | null; notes?: string | null },
) {
  const current = await getClient(db, clientId, firmId);
  if (!current) return null;

  const name = input.name ?? (current as { name: string }).name;
  const legal =
    input.legal_name !== undefined
      ? input.legal_name
      : (current as { legal_name: string | null }).legal_name;
  const notes =
    input.notes !== undefined ? input.notes : (current as { notes: string | null }).notes;

  await db
    .prepare(
      `UPDATE clients SET name = ?, legal_name = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ? AND firm_id = ?`,
    )
    .bind(name, legal, notes, clientId, firmId)
    .run();

  return getClient(db, clientId, firmId);
}

export async function deleteClient(db: D1Database, clientId: string, firmId: string) {
  const res = await db
    .prepare(`DELETE FROM clients WHERE id = ? AND firm_id = ?`)
    .bind(clientId, firmId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
