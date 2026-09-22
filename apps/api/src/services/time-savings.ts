import type { Db } from "../db";

export type TimeSavings = {
  weeklyData: Array<{ week: string; hoursSaved: number; target: number }>;
  totalHoursSaved: number;
  hoursFromReceipts: number;
  hoursFromBank: number;
  hoursFromChasing: number;
  hoursFromEsign: number;
  measuredEvents: number;
  estimateMethod: string;
  weeksToTarget: number | null;
  progressPercent: number;
};

/**
 * A deliberately conservative, evidence-derived estimate. It measures only
 * completed records created this week; it never invents an opening baseline
 * or treats an unsigned request as time returned.
 */
export async function getWeeklyTimeSavings(db: Db, firmId: string): Promise<TimeSavings> {
  const [receipts] = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM receipts r JOIN clients c ON c.id=r.client_id WHERE c.firm_id=$1 AND r.status IN ('filed','matched','approved') AND r.created_at >= date_trunc('week', NOW())`, [firmId]);
  const [bank] = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM bank_transactions bt JOIN clients c ON c.id=bt.client_id WHERE c.firm_id=$1 AND bt.disposition IS NOT NULL AND bt.created_at >= date_trunc('week', NOW())`, [firmId]);
  const [requests] = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM client_requests WHERE firm_id=$1 AND status='satisfied' AND created_at >= date_trunc('week', NOW())`, [firmId]);
  const [signatures] = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM signature_requests WHERE firm_id=$1 AND status='signed' AND signed_at >= date_trunc('week', NOW())`, [firmId]);
  const receiptCount = Number(receipts?.count || 0); const bankCount = Number(bank?.count || 0);
  const requestCount = Number(requests?.count || 0); const signatureCount = Number(signatures?.count || 0);
  const hoursFromReceipts = Math.round(receiptCount * 4.5) / 60;
  const hoursFromBank = Math.round(bankCount * 2.5) / 60;
  const hoursFromChasing = Math.round(requestCount * 15) / 60;
  const hoursFromEsign = Math.round(signatureCount * 25) / 60;
  const totalHoursSaved = Math.round((hoursFromReceipts + hoursFromBank + hoursFromChasing + hoursFromEsign) * 10) / 10;
  const target = 10;
  return {
    weeklyData: [{ week: "This week", hoursSaved: totalHoursSaved, target }], totalHoursSaved,
    hoursFromReceipts: Math.round(hoursFromReceipts * 10) / 10, hoursFromBank: Math.round(hoursFromBank * 10) / 10,
    hoursFromChasing: Math.round(hoursFromChasing * 10) / 10, hoursFromEsign: Math.round(hoursFromEsign * 10) / 10,
    measuredEvents: receiptCount + bankCount + requestCount + signatureCount,
    estimateMethod: "Completed receipt 4.5 min; categorized bank line 2.5 min; satisfied client request 15 min; completed signature 25 min.",
    weeksToTarget: totalHoursSaved >= target ? 0 : null, progressPercent: Math.min(100, Math.round((totalHoursSaved / target) * 100)),
  };
}
