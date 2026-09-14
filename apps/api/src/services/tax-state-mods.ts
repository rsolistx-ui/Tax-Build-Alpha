import type { Db } from "../db";
import { newId } from "../lib/id";

export async function listStateMods(db: Db, firmId: string, clientId: string, taxYear: number) {
  return db.query<any>(`SELECT * FROM state_tax_modifications WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3 ORDER BY state, modification_type`, [firmId, clientId, taxYear]);
}

export async function createStateMod(db: Db, firmId: string, clientId: string, input: { state: string; taxYear: number; modificationType: string; description: string; amount: number; federalLineCode?: string; stateLineCode?: string; apportionmentFactor?: number }) {
  const id = newId("stm");
  const [row] = await db.query<any>(`INSERT INTO state_tax_modifications (id,firm_id,client_id,state,tax_year,modification_type,description,amount,federal_line_code,state_line_code,apportionment_factor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [id, firmId, clientId, input.state, input.taxYear, input.modificationType, input.description, input.amount, input.federalLineCode ?? null, input.stateLineCode ?? null, input.apportionmentFactor ?? null]);
  return row;
}
