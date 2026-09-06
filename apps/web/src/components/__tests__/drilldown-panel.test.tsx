import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DrilldownPanel } from "@/components/drilldown-panel";
import { buildDrilldownPath } from "@/types/pnl";
import type { DrilldownState } from "@/types/pnl";

const identityApiUrl = (path: string) => path;

describe("buildDrilldownPath", () => {
  it("requests type=income for an income category", () => {
    const path = buildDrilldownPath("client_1", "Consulting", "income", null, null);
    expect(path).toBe("/api/clients/client_1/pnl/drilldown?category=Consulting&type=income");
  });

  it("requests type=expense for an expense category and includes date bounds", () => {
    const path = buildDrilldownPath("client_1", "Supplies", "expense", "2026-01-01", "2026-01-31");
    expect(path).toBe(
      "/api/clients/client_1/pnl/drilldown?category=Supplies&type=expense&startDate=2026-01-01&endDate=2026-01-31",
    );
  });
});

describe("DrilldownPanel - income source traceability", () => {
  it("displays source filename, source row, import batch, signed amount, and reported amount", () => {
    const drilldown: DrilldownState = {
      type: "income",
      category: "Consulting",
      entries: [
        {
          bankTransactionId: "txn_1",
          date: "2026-03-10",
          description: "Client payment",
          amount: -100,
          reportedAmount: -100,
          category: "Consulting",
          dispositionNote: null,
          sourceFilename: "bank-march.csv",
          sourceRow: 7,
          importBatchId: "imp_42",
          originalRow: { Date: "2026-03-10", Amount: "-100.00" },
        },
      ],
    };
    render(<DrilldownPanel drilldown={drilldown} apiUrl={identityApiUrl} />);

    expect(screen.getAllByText(/-100\.00/).length).toBeGreaterThanOrEqual(2);

    const summary = screen.getByText("Source import details");
    summary.click();
    expect(screen.getByText(/bank-march\.csv/)).toBeInTheDocument();
    expect(screen.getByText(/CSV row: 7/)).toBeInTheDocument();
    expect(screen.getByText(/imp_42/)).toBeInTheDocument();
  });

  it("shows nothing selected when drilldown is null", () => {
    render(<DrilldownPanel drilldown={null} apiUrl={identityApiUrl} />);
    expect(screen.getByText("Nothing selected.")).toBeInTheDocument();
  });
});
