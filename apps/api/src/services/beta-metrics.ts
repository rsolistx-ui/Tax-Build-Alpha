import type { Db } from "../db";
import { TIME_SAVED_MINUTES } from "./time-savings";

/**
 * Beta metrics from the gap analysis ("Beta metrics that make the claims provable"),
 * across every firm, for the owner's /control dashboard. Each metric reports its value,
 * the sample it rests on, and a status only when there is a target and enough data:
 * a figure from three receipts is shown as collecting, not as a pass.
 */

export type MetricStatus = "meets" | "misses" | "collecting" | "no_target";
export type BetaMetric = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  sample: number;
  target: string | null;
  status: MetricStatus;
  detail: string[];
};

/** Fields compared between what was first read from a receipt and what was filed. */
export const RECEIPT_FIELDS = ["date", "merchant", "total", "tax", "category"] as const;
type ReceiptField = (typeof RECEIPT_FIELDS)[number];
export type ReceiptSnapshot = Record<ReceiptField, string | number | null>;

const norm = (field: ReceiptField, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (field === "date") return String(v).slice(0, 10);
  if (field === "total" || field === "tax") return Number(v).toFixed(2);
  return String(v).trim().toLowerCase();
};

/** Pure: which fields a reviewer changed between the first reading and the filed receipt. */
export function changedFields(first: ReceiptSnapshot, filed: ReceiptSnapshot): ReceiptField[] {
  return RECEIPT_FIELDS.filter((f) => norm(f, first[f]) !== norm(f, filed[f]));
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

export type BetaMetricsInput = {
  receipts: Array<{ changed: ReceiptField[]; secondsToFiled: number | null }>;
  requests: { completedDays: number[]; open: number };
  api: { requests: number; serverErrors: number };
  support: { hoursToFirstResponse: number[]; awaiting: number };
  timeSaved: { receipts: number; bankLines: number; requests: number; signatures: number; activeClients: number };
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pure: raw counts in, dashboard rows out. */
export function buildBetaMetrics(input: BetaMetricsInput): BetaMetric[] {
  const r = input.receipts;
  const untouched = r.filter((x) => x.changed.length === 0).length;
  const fieldMisses = RECEIPT_FIELDS.map((f) => ({ f, n: r.filter((x) => x.changed.includes(f)).length })).filter((x) => x.n > 0);
  const accuracy = r.length ? round((untouched / r.length) * 100) : null;
  const upload = median(r.map((x) => x.secondsToFiled).filter((s): s is number => s !== null));
  const requestDays = median(input.requests.completedDays);
  const errorRate = input.api.requests ? round((input.api.serverErrors / input.api.requests) * 100, 3) : null;
  const firstResponse = median(input.support.hoursToFirstResponse);
  const t = input.timeSaved;
  const hours = (t.receipts * TIME_SAVED_MINUTES.receipt + t.bankLines * TIME_SAVED_MINUTES.bankLine + t.requests * TIME_SAVED_MINUTES.request + t.signatures * TIME_SAVED_MINUTES.signature) / 60;

  return [
    {
      key: "receipt_accuracy", label: "Receipts filed with no field edited", value: accuracy, unit: "%", sample: r.length,
      target: "Set after 200 real receipts", status: r.length < 200 ? "collecting" : "no_target",
      detail: [
        `${untouched} of ${r.length} filed without a change to date, merchant, total, tax or category`,
        ...fieldMisses.map((x) => `${x.f} corrected on ${x.n}`),
      ],
    },
    {
      key: "upload_to_categorized", label: "Receipt upload to filed, median", value: upload === null ? null : round(upload / 60), unit: "minutes", sample: r.length,
      target: "Set after 200 real receipts", status: r.length < 200 ? "collecting" : "no_target",
      detail: ["Includes time waiting for review, not only reading time"],
    },
    {
      key: "request_to_completed", label: "Document request sent to completed, median", value: requestDays === null ? null : round(requestDays), unit: "days", sample: input.requests.completedDays.length,
      target: "Beat the firm's current process", status: "no_target",
      detail: [`${input.requests.open} request(s) still open`],
    },
    {
      key: "server_error_rate", label: "Server errors (5xx) returned by the app", value: errorRate, unit: "%", sample: input.api.requests,
      target: "Under 0.1%", status: input.api.requests < 1000 ? "collecting" : errorRate !== null && errorRate < 0.1 ? "meets" : "misses",
      detail: [
        `${input.api.serverErrors} of ${input.api.requests} requests`,
        "Excludes platform limit errors (Workers CPU 503s) that stop a request before the app runs",
        "Includes the automated production smoke test's own requests",
      ],
    },
    {
      key: "support_first_response", label: "Support first response, median", value: firstResponse === null ? null : round(firstResponse), unit: "hours", sample: input.support.hoursToFirstResponse.length,
      target: "Same business day (under 8 hours)",
      status: input.support.hoursToFirstResponse.length < 5 ? "collecting" : firstResponse !== null && firstResponse < 8 ? "meets" : "misses",
      detail: [`${input.support.awaiting} ticket(s) awaiting a first response`, "The instant automatic reply is not counted"],
    },
    {
      key: "hours_saved", label: "Preparer hours saved per active client (estimate)", value: t.activeClients ? round(hours / t.activeClients) : null, unit: "hours", sample: t.activeClients,
      target: "Confirm against timesheets", status: "no_target",
      detail: [
        `${round(hours)} hours total across ${t.activeClients} active client(s)`,
        `Per event: receipt ${TIME_SAVED_MINUTES.receipt} min, bank line ${TIME_SAVED_MINUTES.bankLine} min, request ${TIME_SAVED_MINUTES.request} min, signature ${TIME_SAVED_MINUTES.signature} min`,
      ],
    },
  ];
}

export async function loadBetaMetrics(db: Db, days: number): Promise<BetaMetric[]> {
  const since = `NOW() - make_interval(days => $1)`;
  const [receipts, requests, openRequests, apiStats, tickets, awaiting, counts] = await Promise.all([
    db.query<{ first: ReceiptSnapshot | null; date: string | null; merchant: string | null; total: string | null; tax: string | null; category: string | null; seconds: string | null }>(
      `SELECT r.extracted_date::text AS date, r.extracted_merchant AS merchant, r.extracted_total::text AS total,
              r.extracted_tax::text AS tax, r.extracted_category AS category,
              EXTRACT(EPOCH FROM (r.reviewed_at - r.created_at))::text AS seconds,
              (SELECT jsonb_build_object('date', a.before_json->>'extracted_date', 'merchant', a.before_json->>'extracted_merchant',
                                         'total', a.before_json->>'extracted_total', 'tax', a.before_json->>'extracted_tax',
                                         'category', a.before_json->>'extracted_category')
                 FROM audit_events a WHERE a.receipt_id = r.id AND a.action = 'receipt_review_edited'
                 ORDER BY a.created_at ASC LIMIT 1) AS first
         FROM receipts r
        WHERE r.status = 'filed' AND r.provider IS NOT NULL AND r.reviewed_at >= ${since}`,
      [days],
    ),
    db.query<{ days: string }>(
      `SELECT (EXTRACT(EPOCH FROM (satisfied_at - COALESCE(approved_at, created_at))) / 86400)::text AS days
         FROM client_requests WHERE satisfied_at >= ${since}`,
      [days],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM client_requests WHERE satisfied_at IS NULL AND status NOT IN ('draft', 'cancelled', 'satisfied')`,
      [],
    ),
    db.query<{ requests: string; errors: string }>(
      `SELECT COALESCE(SUM(requests), 0)::text AS requests, COALESCE(SUM(server_errors), 0)::text AS errors
         FROM api_daily_stats WHERE day > (NOW() - make_interval(days => $1))::date`,
      [days],
    ),
    db.query<{ hours: string }>(
      `SELECT (EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600)::text AS hours
         FROM support_tickets WHERE first_response_at IS NOT NULL AND created_at >= ${since}`,
      [days],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM support_tickets WHERE first_response_at IS NULL AND status <> 'resolved'`,
      [],
    ),
    db.query<{ receipts: string; bank: string; requests: string; signatures: string; clients: string }>(
      `SELECT
         (SELECT COUNT(*) FROM receipts WHERE status = 'filed' AND reviewed_at >= ${since})::text AS receipts,
         (SELECT COUNT(*) FROM bank_transactions WHERE disposition <> 'unclassified' AND disposition_reviewed_at >= ${since})::text AS bank,
         (SELECT COUNT(*) FROM client_requests WHERE satisfied_at >= ${since})::text AS requests,
         (SELECT COUNT(*) FROM signature_requests WHERE status = 'signed' AND signed_at >= ${since})::text AS signatures,
         (SELECT COUNT(DISTINCT client_id) FROM (
            SELECT client_id FROM receipts WHERE reviewed_at >= ${since}
            UNION SELECT client_id FROM bank_transactions WHERE disposition_reviewed_at >= ${since}
            UNION SELECT client_id FROM client_requests WHERE satisfied_at >= ${since}) active)::text AS clients`,
      [days],
    ),
  ]);
  const c = counts[0];
  return buildBetaMetrics({
    receipts: receipts.map((row) => {
      const filed: ReceiptSnapshot = { date: row.date, merchant: row.merchant, total: row.total, tax: row.tax, category: row.category };
      return { changed: row.first ? changedFields(row.first, filed) : [], secondsToFiled: row.seconds === null ? null : Number(row.seconds) };
    }),
    requests: { completedDays: requests.map((r) => Number(r.days)), open: Number(openRequests[0]?.count ?? 0) },
    api: { requests: Number(apiStats[0]?.requests ?? 0), serverErrors: Number(apiStats[0]?.errors ?? 0) },
    support: { hoursToFirstResponse: tickets.map((t) => Number(t.hours)), awaiting: Number(awaiting[0]?.count ?? 0) },
    timeSaved: {
      receipts: Number(c?.receipts ?? 0), bankLines: Number(c?.bank ?? 0), requests: Number(c?.requests ?? 0),
      signatures: Number(c?.signatures ?? 0), activeClients: Number(c?.clients ?? 0),
    },
  });
}
