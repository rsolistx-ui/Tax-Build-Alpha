import type { Db } from "../db";
import { newId } from "../lib/id";

export type TaxWorkpaper = { id: string; firm_id: string; client_id: string; tax_year: number; name: string; data: any; created_at: string; updated_at: string };

export async function getTaxWorkpaper(db: Db, firmId: string, clientId: string, taxYear: number): Promise<TaxWorkpaper | undefined> {
  const [row] = await db.query<any>(`SELECT * FROM tax_workpapers WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3`, [firmId, clientId, taxYear]);
  return row ? mapRow(row) : undefined;
}

export async function upsertTaxWorkpaper(db: Db, firmId: string, clientId: string, taxYear: number, data: any, name?: string): Promise<TaxWorkpaper> {
  const existing = await getTaxWorkpaper(db, firmId, clientId, taxYear);
  if (existing) {
    const [row] = await db.query<any>(`UPDATE tax_workpapers SET data=$1, name=COALESCE($2,name), updated_at=NOW() WHERE id=$3 RETURNING *`, [JSON.stringify(data), name ?? null, existing.id]);
    return mapRow(row);
  }
  const id = newId("twp");
  const [row] = await db.query<any>(`INSERT INTO tax_workpapers (id,firm_id,client_id,tax_year,name,data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [id, firmId, clientId, taxYear, name ?? "Workpaper", JSON.stringify(data)]);
  return mapRow(row);
}

function mapRow(r: any): TaxWorkpaper {
  return { id: r.id, firm_id: r.firm_id, client_id: r.client_id, tax_year: r.tax_year, name: r.name, data: typeof r.data === "string" ? JSON.parse(r.data) : r.data, created_at: r.created_at, updated_at: r.updated_at };
}
