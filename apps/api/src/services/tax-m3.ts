import type { Db } from "../db";
import { newId } from "../lib/id";

export async function listM3(db: Db, firmId: string, clientId: string, taxYear: number) {
  const [recon] = await db.query<any>(`SELECT * FROM m3_reconciliations WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3`, [firmId, clientId, taxYear]);
  if (!recon) return null;
  const lines = await db.query<any>(`SELECT * FROM m3_reconciliation_lines WHERE reconciliation_id=$1 ORDER BY sort_order`, [recon.id]);
  return { reconciliation: recon, lines };
}

export async function createM3(db: Db, firmId: string, clientId: string, taxYear: number) {
  const id = newId("m3r");
  const now = new Date().toISOString();
  const [row] = await db.query<any>(`INSERT INTO m3_reconciliations (id,firm_id,client_id,tax_year,net_income_per_books,taxable_income,status,created_at,updated_at) VALUES ($1,$2,$3,$4,0,0,'draft',$5,$6) RETURNING *`, [id, firmId, clientId, taxYear, now, now]);
  return row;
}

export async function addM3Line(db: Db, reconciliationId: string, input: { part: string; lineCode: string; lineLabel: string; lineCategory: string; perBooks: number; temporaryDiff: number; permanentDiff: number; otherDiff: number; sortOrder?: number; notes?: string }) {
  const id = newId("m3l");
  const [row] = await db.query<any>(`INSERT INTO m3_reconciliation_lines (id,reconciliation_id,part,line_code,line_label,line_category,per_books,temporary_diff,permanent_diff,other_diff,sort_order,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [id, reconciliationId, input.part, input.lineCode, input.lineLabel, input.lineCategory, input.perBooks, input.temporaryDiff, input.permanentDiff, input.otherDiff, input.sortOrder ?? 0, input.notes ?? null]);
  return row;
}
