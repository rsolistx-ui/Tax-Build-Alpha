import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage, matchesFilter } from "@/pages/dashboard";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

const READY_ROW = {
  id: "cli_ready",
  name: "Ready Co",
  legalName: null,
  taxYear: 2026,
  accountingBasis: "cash",
  currency: "USD",
  updatedAt: new Date().toISOString(),
  readiness: "ready" as const,
  receiptReviewCount: 0,
  missingEvidenceCount: 0,
  unresolvedBankExceptionCount: 0,
  unclassifiedCount: 0,
  uncategorizedCount: 0,
  currencyConflictCount: 0,
  filedReceiptCount: 1,
  isComplete: true,
};

describe("matchesFilter", () => {
  it("needs_attention matches any non-ready readiness", () => {
    expect(matchesFilter(READY_ROW, "needs_attention")).toBe(false);
    expect(matchesFilter({ ...READY_ROW, readiness: "missing_evidence" }, "needs_attention")).toBe(true);
  });

  it("bank_issues matches unresolved bank exceptions, unclassified, or currency conflicts", () => {
    expect(matchesFilter({ ...READY_ROW, unresolvedBankExceptionCount: 1 }, "bank_issues")).toBe(true);
    expect(matchesFilter(READY_ROW, "bank_issues")).toBe(false);
  });
});

describe("DashboardPage", () => {
  it("renders the no-clients empty state rather than an empty dashboard", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: { clients: 0, clientsReady: 0, clientsNeedingAttention: 0, totalOpenActions: 0, receiptsAwaitingReview: 0, missingEvidence: 0, unresolvedBankExceptions: 0, unclassifiedTransactions: 0, uncategorizedActivity: 0, currencyConflicts: 0 },
      clients: [],
      actions: [],
      recentActivity: [],
    });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No clients yet/i)).toBeInTheDocument();
  });

  it("shows the caught-up state when there are clients but zero open actions", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: { clients: 1, clientsReady: 1, clientsNeedingAttention: 0, totalOpenActions: 0, receiptsAwaitingReview: 0, missingEvidence: 0, unresolvedBankExceptions: 0, unclassifiedTransactions: 0, uncategorizedActivity: 0, currencyConflicts: 0 },
      clients: [READY_ROW],
      actions: [],
      recentActivity: [],
    });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/You're caught up/i)).toBeInTheDocument();
  });

  it("renders a deep-linked action queue item pointing at its exact resolution destination", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: { clients: 1, clientsReady: 0, clientsNeedingAttention: 1, totalOpenActions: 1, receiptsAwaitingReview: 0, missingEvidence: 1, unresolvedBankExceptions: 0, unclassifiedTransactions: 0, uncategorizedActivity: 0, currencyConflicts: 0 },
      clients: [{ ...READY_ROW, id: "cli_needs", readiness: "missing_evidence", missingEvidenceCount: 1 }],
      actions: [
        {
          id: "missing_evidence:t1",
          clientId: "cli_needs",
          clientName: "Needs Co",
          type: "missing_evidence",
          priority: 2,
          explanation: "Missing receipt or evidence for a purchase",
          date: "2026-01-05",
          sourceEntityId: "t1",
          deepLink: "/clients/cli_needs?tab=bank&focus=t1",
        },
      ],
      recentActivity: [],
    });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: /Missing receipt or evidence/i });
    expect(link).toHaveAttribute("href", "/clients/cli_needs?tab=bank&focus=t1");
  });
  it("renders Practice OS metrics with deep links into the matching work-queue view", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: { clients: 1, clientsReady: 1, clientsNeedingAttention: 0, totalOpenActions: 0, receiptsAwaitingReview: 0, missingEvidence: 0, unresolvedBankExceptions: 0, unclassifiedTransactions: 0, uncategorizedActivity: 0, currencyConflicts: 0 },
      clients: [READY_ROW],
      actions: [],
      recentActivity: [],
      operationsCommandCenter: {
        openEngagements: 3,
        waitingOnClientCount: 2,
        overdueWorkCount: 1,
        dueTodayWorkCount: 0,
        dueSoonWorkCount: 4,
        professionalReviewCount: 5,
        blockedCount: 0,
        oldestPendingRequestDays: 9,
      },
    });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Open engagements")).toBeInTheDocument();
    const overdueLink = screen.getByText("Overdue work").closest("a");
    expect(overdueLink).toHaveAttribute("href", "/work-queue?view=overdue");
    const waitingLink = screen.getByText("Waiting on client").closest("a");
    expect(waitingLink).toHaveAttribute("href", "/work-queue?view=waiting_on_client");
    expect(screen.getByText("9d")).toBeInTheDocument();
  });

  it("does not render the Practice OS strip when the backend omits operationsCommandCenter", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: { clients: 1, clientsReady: 1, clientsNeedingAttention: 0, totalOpenActions: 0, receiptsAwaitingReview: 0, missingEvidence: 0, unresolvedBankExceptions: 0, unclassifiedTransactions: 0, uncategorizedActivity: 0, currencyConflicts: 0 },
      clients: [READY_ROW],
      actions: [],
      recentActivity: [],
    });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Clients");
    expect(screen.queryByText("Open engagements")).not.toBeInTheDocument();
  });
});
