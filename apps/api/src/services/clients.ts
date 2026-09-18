import type { Db } from "../db";
import { DEFAULT_CATEGORIES } from "../lib/defaults";
import { newId } from "../lib/id";

export type ClientRow = {
  id: string;
  firm_id: string;
  name: string;
  legal_name: string | null;
  notes: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export async function listClients(db: Db, firmId: string): Promise<ClientRow[]> {
  return db.query<ClientRow>(
    `SELECT id, firm_id, name, legal_name, notes, email, phone, created_at, updated_at
     FROM clients WHERE firm_id = $1 ORDER BY LOWER(name)`,
    [firmId],
  );
}

export async function getClient(db: Db, clientId: string, firmId: string): Promise<ClientRow | undefined> {
  const [client] = await db.query<ClientRow>(
    `SELECT * FROM clients WHERE id = $1 AND firm_id = $2`,
    [clientId, firmId],
  );
  return client;
}

export async function createClient(
  db: Db,
  firmId: string,
  input: { name: string; legal_name?: string; notes?: string; email?: string; phone?: string },
): Promise<ClientRow | undefined> {
  const id = newId("cli");
  const statements = [
    {
      query: `INSERT INTO clients (id, firm_id, name, legal_name, notes, email, phone) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      params: [id, firmId, input.name, input.legal_name ?? null, input.notes ?? null, input.email ?? null, input.phone ?? null],
    },
    ...DEFAULT_CATEGORIES.map((category) => ({
      query: `INSERT INTO categories (id, client_id, name, slug, is_default, sort_order)
              VALUES ($1, $2, $3, $4, TRUE, $5)`,
      params: [newId("cat"), id, category.name, category.slug, category.sort_order],
    })),
    {
      query: `INSERT INTO client_profiles (client_id, default_currency) VALUES ($1, 'USD')`,
      params: [id],
    },
  ];

  await db.transaction(statements);
  return getClient(db, id, firmId);
}

export async function updateClient(
  db: Db,
  clientId: string,
  firmId: string,
  input: { name?: string; legal_name?: string | null; notes?: string | null; email?: string | null; phone?: string | null },
): Promise<ClientRow | undefined> {
  const current = await getClient(db, clientId, firmId);
  if (!current) return undefined;

  const name = input.name ?? current.name;
  const legalName = input.legal_name !== undefined ? input.legal_name : current.legal_name;
  const notes = input.notes !== undefined ? input.notes : current.notes;
  const email = input.email !== undefined ? input.email : current.email;
  const phone = input.phone !== undefined ? input.phone : current.phone;

  await db.query(
    `UPDATE clients
     SET name = $1, legal_name = $2, notes = $3, email = $4, phone = $5, updated_at = NOW()
     WHERE id = $6 AND firm_id = $7`,
    [name, legalName, notes, email, phone, clientId, firmId],
  );
  return getClient(db, clientId, firmId);
}

export async function deleteClient(db: Db, clientId: string, firmId: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `DELETE FROM clients WHERE id = $1 AND firm_id = $2 RETURNING id`,
    [clientId, firmId],
  );
  return rows.length > 0;
}
