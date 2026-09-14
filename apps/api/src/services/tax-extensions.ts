import type { Db } from "../db";
import { newId } from "../lib/id";

export async function listExtensions(db: Db, firmId: string, clientId: string) {
  return db.query<any>(`SELECT * FROM tax_extensions WHERE firm_id=$1 AND client_id=$2 ORDER BY tax_year DESC`, [firmId, clientId]);
}

export async function createExtension(db: Db, firmId: string, clientId: string, input: { taxYear: number; formType: string; dueDate: string }) {
  const id = newId("tex");
  const [row] = await db.query<any>(`INSERT INTO tax_extensions (id,firm_id,client_id,tax_year,form_type,due_date,status) VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`, [id, firmId, clientId, input.taxYear, input.formType, input.dueDate]);
  return row;
}
