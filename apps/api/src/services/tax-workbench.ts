import type { Db } from "../db";
import { runTaxDiagnostics, type Diagnostic } from "./tax-diagnostics";
import { suggestReadinessState, type TaxReadinessState } from "./tax-readiness";

export async function calculateReadinessFromDiagnostics(
  db: Db,
  clientId: string,
  taxYear: number,
): Promise<TaxReadinessState> {
  const diags = await runTaxDiagnostics(db, clientId, taxYear);
  const taxPrepRequired = true;
  const bookkeepingComplete = true;
  const [checklistItems] = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM client_checklist_items WHERE client_id = $1`,
    [clientId],
  );
  const [completedChecklist] = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM client_checklist_items WHERE client_id = $1 AND (status = 'received' OR status = 'reviewed')`,
    [clientId],
  );
  const totalChecklistItems = Number(checklistItems?.count ?? 0);
  const receivedOrReviewedChecklistItems = Number(completedChecklist?.count ?? 0);

  return suggestReadinessState({
    taxPrepRequired,
    bookkeepingComplete,
    totalChecklistItems,
    receivedOrReviewedChecklistItems,
  });
}
