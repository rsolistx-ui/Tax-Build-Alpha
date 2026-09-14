import type { Db } from "../db";

export async function priorYearCompare(db: Db, firmId: string, clientId: string, taxYear: number) {
  const priorYear = taxYear - 1;
  const [prior, current] = await Promise.all([
    db.query<any>(`SELECT form_line_code, form_line_label FROM tax_form_mappings WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3 ORDER BY sort_order`, [firmId, clientId, priorYear]),
    db.query<any>(`SELECT form_line_code, form_line_label FROM tax_form_mappings WHERE firm_id=$1 AND client_id=$2 AND tax_year=$3 ORDER BY sort_order`, [firmId, clientId, taxYear]),
  ]);
  const priorSet = new Set(prior.map((r: any) => r.form_line_code));
  const added = current.filter((r: any) => !priorSet.has(r.form_line_code));
  const removed = prior.filter((r: any) => !current.find((c: any) => c.form_line_code === r.form_line_code));
  return { priorYear, taxYear, added, removed, priorCount: prior.length, currentCount: current.length };
}
