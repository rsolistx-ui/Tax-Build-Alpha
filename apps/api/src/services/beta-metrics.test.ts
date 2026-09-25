import { describe, expect, it } from "vitest";
import { buildBetaMetrics, changedFields, type BetaMetricsInput } from "./beta-metrics";

const empty: BetaMetricsInput = {
  receipts: [],
  requests: { completedDays: [], open: 0 },
  api: { requests: 0, serverErrors: 0 },
  support: { hoursToFirstResponse: [], awaiting: 0 },
  timeSaved: { receipts: 0, bankLines: 0, requests: 0, signatures: 0, activeClients: 0 },
};
const metric = (input: BetaMetricsInput, key: string) => buildBetaMetrics(input).find((m) => m.key === key)!;

describe("changedFields", () => {
  it("ignores formatting differences and reports real corrections", () => {
    const first = { date: "2026-09-05T00:00:00.000Z", merchant: "FOLIO Supply ", total: "64.9", tax: null, category: "Supplies" };
    const filed = { date: "2026-09-05", merchant: "folio supply", total: 64.95, tax: "", category: "Office" };
    expect(changedFields(first, filed)).toEqual(["total", "category"]);
  });
});

describe("buildBetaMetrics", () => {
  it("reports receipt accuracy and field corrections, and stays collecting under 200 receipts", () => {
    const m = metric({ ...empty, receipts: [{ changed: [], secondsToFiled: 60 }, { changed: ["total"], secondsToFiled: 180 }, { changed: [], secondsToFiled: 120 }] }, "receipt_accuracy");
    expect(m).toMatchObject({ value: 66.7, sample: 3, status: "collecting" });
    expect(m.detail).toContain("total corrected on 1");
    expect(metric({ ...empty, receipts: [{ changed: [], secondsToFiled: 60 }, { changed: [], secondsToFiled: 180 }] }, "upload_to_categorized").value).toBe(2);
  });

  it("judges the 5xx rate against 0.1% only with enough requests", () => {
    expect(metric({ ...empty, api: { requests: 500, serverErrors: 0 } }, "server_error_rate").status).toBe("collecting");
    expect(metric({ ...empty, api: { requests: 5000, serverErrors: 2 } }, "server_error_rate")).toMatchObject({ value: 0.04, status: "meets" });
    expect(metric({ ...empty, api: { requests: 5000, serverErrors: 10 } }, "server_error_rate")).toMatchObject({ value: 0.2, status: "misses" });
  });

  it("judges support response against same business day once there are five replies", () => {
    expect(metric({ ...empty, support: { hoursToFirstResponse: [1, 2], awaiting: 1 } }, "support_first_response").status).toBe("collecting");
    expect(metric({ ...empty, support: { hoursToFirstResponse: [1, 2, 3, 20, 30], awaiting: 0 } }, "support_first_response")).toMatchObject({ value: 3, status: "meets" });
  });

  it("gives medians for requests and hours saved per active client", () => {
    expect(metric({ ...empty, requests: { completedDays: [1, 5, 2], open: 4 } }, "request_to_completed")).toMatchObject({ value: 2, sample: 3 });
    // 12 receipts x 4.5 min + 24 bank lines x 2.5 min = 114 min = 1.9 hours, one active client
    expect(metric({ ...empty, timeSaved: { receipts: 12, bankLines: 24, requests: 0, signatures: 0, activeClients: 1 } }, "hours_saved").value).toBe(1.9);
  });

  it("shows no value, not zero, when there is no data", () => {
    for (const m of buildBetaMetrics(empty)) expect(m.value).toBeNull();
  });
});
