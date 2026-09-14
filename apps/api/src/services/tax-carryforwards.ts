import type { Db } from "../db";
import { newId } from "../lib/id";

export type TaxCarryforward = { id: string; firm_id: string; client_id: string; carryforward_type: string; state: string | null; tax_year_generated: number; tax_year_expires: number | null; original_amount: number; remaining_amount: number; used_amount: number; status: string; notes: string | null; created_at: string; updated_at: string };

export async function listCarryforwards(db: Db, firmId: string, clientId: string): Promise<TaxCarryforward[]> {
  const rows = await db.query<any>(`SELECT * FROM tax_carryforwards WHERE firm_id=$1 AND client_id=$2 ORDER BY tax_year_generated`, [firmId, clientId]);
  return rows as any;
}

export async function createCarryforward(db: Db, firmId: string, clientId: string, input: { carryforwardType: string; state?: string; taxYearGenerated: number; taxYearExpires?: number; originalAmount: number; notes?: string }): Promise<TaxCarryforward> {
  const id = newId("tcf");
  const now = new Date().toISOString();
  const [row] = await db.query<any>(`INSERT INTO tax_carryforwards (id,firm_id,client_id,carryforward_type,state,tax_year_generated,tax_year_expires,original_amount,remaining_amount,used_amount,status,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,0,'active',$9,$10,$10) RETURNING *`, [id, firmId, clientId, input.carryforwardType, input.state ?? null, input.taxYearGenerated, input.taxYearExpires ?? null, input.originalAmount, input.notes ?? null, now]);
  return row;
}

export async function utilizeCarryforward(db: Db, carryforwardId: string, taxYearUsed: number, amountUsed: number, returnType: string): Promise<void> {
  const [cf] = await db.query<any>(`SELECT * FROM tax_carryforwards WHERE id=$1`, [carryforwardId]);
  if (!cf) throw new Error("Carryforward not found");
  if (Number(cf.remaining_amount) < amountUsed) throw new Error("Insufficient remaining amount");
  const id = newId("tcfu");
  await db.query(`INSERT INTO tax_carryforward_utilization (id,carryforward_id,tax_year_used,amount_used,return_type) VALUES ($1,$2,$3,$4,$5)`, [id, carryforwardId, taxYearUsed, amountUsed, returnType]);
  const newRemaining = Number(cf.remaining_amount) - amountUsed;
  const newUsed = Number(cf.used_amount) + amountUsed;
  const status = newRemaining <= 0.005 ? "fully_used" : "active";
  await db.query(`UPDATE tax_carryforwards SET remaining_amount=$1, used_amount=$2, status=$3, updated_at=NOW() WHERE id=$4`, [newRemaining, newUsed, status, carryforwardId]);
}
