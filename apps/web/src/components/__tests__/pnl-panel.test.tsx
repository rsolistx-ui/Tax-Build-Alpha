import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PnlPanel } from "@/components/pnl-panel";
import type { Pnl } from "@/types/pnl";

const identityApiUrl = (path: string) => path;

describe("PnlPanel - accrual guardrail", () => {
  it("does not render Income/Expenses/Net as $0 when accrualSupported is false", () => {
    const pnl: Pnl = {
      periodStart: null,
      periodEnd: null,
      currency: "USD",
      accountingBasis: "accrual",
      accrualSupported: false,
      warning: "Accrual-basis reporting is not supported yet.",
    };
    render(<PnlPanel pnl={pnl} apiUrl={identityApiUrl} onSelectExpenseCategory={vi.fn()} onSelectIncomeCategory={vi.fn()} />);

    expect(screen.queryByText("Income")).not.toBeInTheDocument();
    expect(screen.queryByText("Expenses")).not.toBeInTheDocument();
    expect(screen.queryByText("Net")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getByText(/Accrual reporting is not available/i)).toBeInTheDocument();
  });

  it("renders Income/Expenses/Net when accrualSupported is not false", () => {
    const pnl: Pnl = {
      periodStart: null,
      periodEnd: null,
      currency: "USD",
      accrualSupported: true,
      income: 1000,
      expenses: 400,
      net: 600,
    };
    render(<PnlPanel pnl={pnl} apiUrl={identityApiUrl} onSelectExpenseCategory={vi.fn()} onSelectIncomeCategory={vi.fn()} />);

    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.getByText("$1000.00")).toBeInTheDocument();
    expect(screen.getByText("$400.00")).toBeInTheDocument();
    expect(screen.getByText("$600.00")).toBeInTheDocument();
  });
});

describe("PnlPanel - excluded filed receipt warning", () => {
  it("renders the exclusion warning when excludedFiledReceiptCount is set", () => {
    const pnl: Pnl = {
      periodStart: null,
      periodEnd: null,
      currency: "USD",
      accrualSupported: true,
      income: 0,
      expenses: 0,
      net: 0,
      excludedFiledReceiptCount: 2,
      excludedFiledReceipts: [
        {
          receiptId: "rec_1",
          merchant: "Acme Co",
          date: "2026-01-05",
          amount: 50,
          filename: "acme.png",
          bankTransactionId: "txn_1",
          bankDisposition: "personal",
          sourceUrl: "/api/clients/c1/receipts/rec_1/source",
        },
      ],
    };
    render(<PnlPanel pnl={pnl} apiUrl={identityApiUrl} onSelectExpenseCategory={vi.fn()} onSelectIncomeCategory={vi.fn()} />);

    expect(screen.getByText(/2 filed receipt\(s\) are excluded from operating expenses/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Co/)).toBeInTheDocument();
  });

  it("does not render the exclusion warning when there is nothing excluded", () => {
    const pnl: Pnl = {
      periodStart: null,
      periodEnd: null,
      currency: "USD",
      accrualSupported: true,
      income: 0,
      expenses: 0,
      net: 0,
      excludedFiledReceiptCount: 0,
    };
    render(<PnlPanel pnl={pnl} apiUrl={identityApiUrl} onSelectExpenseCategory={vi.fn()} onSelectIncomeCategory={vi.fn()} />);
    expect(screen.queryByText(/excluded from operating expenses/i)).not.toBeInTheDocument();
  });
});

describe("PnlPanel - income category interaction", () => {
  it("calls onSelectIncomeCategory when an income category row is clicked", () => {
    const onSelectIncomeCategory = vi.fn();
    const pnl: Pnl = {
      periodStart: null,
      periodEnd: null,
      currency: "USD",
      accrualSupported: true,
      income: 500,
      expenses: 0,
      net: 500,
      categorizedIncome: [{ category: "Consulting", count: 1, total: 500 }],
    };
    render(<PnlPanel pnl={pnl} apiUrl={identityApiUrl} onSelectExpenseCategory={vi.fn()} onSelectIncomeCategory={onSelectIncomeCategory} />);

    fireEvent.click(screen.getByText("Consulting"));
    expect(onSelectIncomeCategory).toHaveBeenCalledWith("Consulting");
  });
});
