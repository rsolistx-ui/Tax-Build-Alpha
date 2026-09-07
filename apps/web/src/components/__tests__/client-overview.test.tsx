import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientOverview } from "@/components/client-overview";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

const BASE_OVERVIEW = {
  header: {
    clientName: "Acme LLC",
    legalName: "Acme Legal LLC",
    entityType: "llc",
    industry: "Retail",
    state: "TX",
    taxYear: 2026,
    accountingBasis: "cash",
    reportingCurrency: "USD",
    bookkeepingReadiness: "books_incomplete",
    taxReadiness: "bookkeeping_incomplete",
    openActionCount: 2,
    lastActivityAt: null,
  },
  financialStatus: {
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    pnlCompleteness: false,
    bankTransactionCount: 5,
    resolvedCount: 3,
    missingEvidenceCount: 1,
    unclassifiedCount: 1,
    uncategorizedCount: 0,
    currencyConflictCount: 0,
  },
  financialPeriod: {
    unsupported: false,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    income: 1000,
    expenses: 400,
    net: 600,
  },
  documentStatus: {
    receiptsReceived: 3,
    receiptsAwaitingReview: 1,
    filedReceipts: 2,
    missingEvidence: 1,
    taxDocumentsReceived: 0,
    taxDocumentsRequested: 1,
    documentsAwaitingReview: 0,
  },
  nextActions: [],
};

function mockApi(overview: unknown = BASE_OVERVIEW) {
  return async (path: string) => {
    if (path.includes("/timeline")) return { events: [] };
    return overview;
  };
}

describe("ClientOverview", () => {
  it("renders bookkeeping readiness and tax readiness as distinct, separately labeled values", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockApi());
    render(<ClientOverview clientId="cli_1" onNavigate={() => {}} />);
    expect(await screen.findByText("Books incomplete")).toBeInTheDocument();
    expect(await screen.findByText("Bookkeeping incomplete")).toBeInTheDocument();
  });

  it("renders canonical income, expenses, and net for the selected reporting period", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockApi());
    render(<ClientOverview clientId="cli_1" onNavigate={() => {}} />);
    expect(await screen.findByText("1000.00")).toBeInTheDocument();
    expect(await screen.findByText("400.00")).toBeInTheDocument();
    expect(await screen.findByText("600.00")).toBeInTheDocument();
  });

  it("shows a null last activity as 'No activity yet' rather than inventing a date", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockApi());
    render(<ClientOverview clientId="cli_1" onNavigate={() => {}} />);
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("shows the accrual guardrail warning instead of fabricated figures when accrual is unsupported", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockApi({
        ...BASE_OVERVIEW,
        financialPeriod: { unsupported: true, warning: "Accrual-basis reporting is not supported yet.", periodStart: null, periodEnd: null },
      }),
    );
    render(<ClientOverview clientId="cli_1" onNavigate={() => {}} />);
    expect(await screen.findByText(/Accrual-basis reporting is not supported yet/)).toBeInTheDocument();
  });

  it("renders resolvedCount and the actual selected reporting-period dates from the API response", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockApi({ ...BASE_OVERVIEW, financialStatus: { ...BASE_OVERVIEW.financialStatus, resolvedCount: 17 } }),
    );
    render(<ClientOverview clientId="cli_1" onNavigate={() => {}} />);
    expect(await screen.findByText("17")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    const periodText = await screen.findByTestId("reporting-period-dates");
    expect(periodText.textContent).toContain("2026-01-01");
    expect(periodText.textContent).toContain("2026-01-31");
  });
});
