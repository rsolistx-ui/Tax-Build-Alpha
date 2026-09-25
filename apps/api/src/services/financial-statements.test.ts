import { describe, expect, it } from "vitest";
import type { AnyDisposition } from "./pnl";
import { computeBalanceSheet, computeCashFlow, dayAfter, dayBefore, transactionsForLine, type StatementAccount, type StatementTxn } from "./financial-statements";

const checking: StatementAccount = { id: "chk", name: "Chase checking", kind: "checking", openingBalance: 1000 };
const card: StatementAccount = { id: "amex", name: "Amex", kind: "credit_card", openingBalance: 200 };
const loan: StatementAccount = { id: "sba", name: "SBA loan", kind: "loan", openingBalance: 5000 };

let seq = 0;
function txn(amount: number, disposition: AnyDisposition, accountId: string | null = "chk", triage = "no_receipt_required", date = "2026-03-01"): StatementTxn {
  return { id: `t${++seq}`, date, amount, disposition, evidenced: triage === "no_receipt_required" || triage === "matched", accountId, description: null };
}
const line = (lines: { key: string; amount: number }[], key: string) => lines.find((l) => l.key === key)?.amount;

describe("computeBalanceSheet", () => {
  it("builds cash, card, loan and equity lines and balances", () => {
    const txns = [
      txn(3000, "business_income"),
      txn(-400, "business_expense"),
      txn(-150, "business_expense", "amex"), // card purchase: owed goes up, no cash moves
      txn(-250, "transfer"), // card payment out of checking
      txn(250, "transfer", "amex"), // and into the card
      txn(-500, "owner_draw"),
      txn(-100, "loan"), // loan payment
    ];
    // P&L net: 3000 - 400 - 150
    const bs = computeBalanceSheet([checking, card, loan], txns, 0, 2450);
    expect(line(bs.assets, "account:chk")).toBe(1000 + 3000 - 400 - 250 - 500 - 100);
    expect(line(bs.liabilities, "account:amex")).toBe(200 + 150 - 250);
    // The only loan account takes the loan payment.
    expect(line(bs.liabilities, "account:sba")).toBe(4900);
    expect(bs.liabilities.some((l) => l.key === "loans")).toBe(false);
    expect(line(bs.equity, "opening")).toBe(1000 - 200 - 5000);
    expect(line(bs.equity, "net_income")).toBe(2450);
    expect(bs.assets.some((l) => l.key === "transfers")).toBe(false); // both sides are in the books
    expect(bs.equity.some((l) => l.key === "paid_outside" || l.key === "differences")).toBe(false);
    expect(bs.totals.difference).toBe(0);
  });

  it("keeps loan activity on one shared line when there are several loans", () => {
    const second: StatementAccount = { id: "car", name: "Truck loan", kind: "loan", openingBalance: 800 };
    const bs = computeBalanceSheet([checking, loan, second], [txn(-100, "loan")], 0, 0);
    expect(line(bs.liabilities, "account:sba")).toBe(5000);
    expect(line(bs.liabilities, "account:car")).toBe(800);
    expect(bs.liabilities.find((l) => l.key === "loans")).toMatchObject({ amount: -100, label: expect.stringContaining("not split by loan") });
    expect(bs.totals.difference).toBe(0);
  });

  it("shows receipts paid outside the business accounts, pending evidence and unclassified activity instead of hiding them", () => {
    const txns = [
      txn(-80, "business_expense", "chk", "unmatched"), // no receipt yet: not in the P&L
      txn(-60, "business_expense", "chk", "matched"), // receipt matched: the P&L counts the receipt
      txn(40, "unclassified"),
      txn(-300, "transfer"), // to an account not in the books
    ];
    // The P&L counts the matched receipt at 65 (bank paid 60) and a receipt paid personally at 35: net -100.
    const bs = computeBalanceSheet([checking], txns, 0, -100, 35);
    expect(line(bs.equity, "awaiting_evidence")).toBe(-80);
    expect(line(bs.equity, "paid_outside")).toBe(35);
    expect(bs.equity.find((l) => l.key === "differences")).toMatchObject({ amount: 5, review: true });
    expect(line(bs.equity, "unclassified")).toBe(40);
    expect(line(bs.assets, "transfers")).toBe(300);
    expect(bs.totals.difference).toBe(0);
  });

  it("always balances, whatever the mix of activity", () => {
    const dispositions: AnyDisposition[] = ["business_income", "business_expense", "personal", "transfer", "owner_contribution", "owner_draw", "loan", "other_excluded", "unclassified"];
    const accounts = [checking, { ...card, openingBalance: 75.5 }, { id: "sav", name: "Savings", kind: "savings" as const, openingBalance: 12.34 }, loan];
    const where = ["chk", "amex", "sav", null];
    let rand = 7;
    const next = () => (rand = (rand * 48271) % 2147483647) / 2147483647;
    for (let run = 0; run < 50; run++) {
      const txns = Array.from({ length: 40 }, () =>
        txn(Math.round((next() - 0.5) * 200000) / 100, dispositions[Math.floor(next() * dispositions.length)], where[Math.floor(next() * where.length)], next() > 0.5 ? "matched" : "unmatched"));
      const bs = computeBalanceSheet(accounts, txns, Math.round(next() * 10000) / 100, Math.round((next() - 0.5) * 10000) / 100, Math.round(next() * 5000) / 100);
      expect(bs.totals.difference).toBe(0);
      const cf = computeCashFlow(accounts, txns.slice(0, 15), txns.slice(15));
      expect(cf.difference).toBe(0);
    }
  });
});

describe("computeCashFlow", () => {
  it("counts cash accounts only, so card purchases move no cash until the card is paid", () => {
    const before = [txn(500, "business_income", "chk", "", "2026-01-10")];
    const during = [
      txn(2000, "business_income"),
      txn(-300, "business_expense"),
      txn(-150, "business_expense", "amex"),
      txn(-250, "transfer"),
      txn(1000, "owner_contribution", null),
    ];
    const cf = computeCashFlow([checking, card], before, during);
    expect(cf.beginningCash).toBe(1500);
    expect(line(cf.operating, "business_expense")).toBe(-300);
    expect(line(cf.transfers, "transfers")).toBe(-250);
    expect(line(cf.financing, "owner_contribution")).toBe(1000);
    expect(cf.netChange).toBe(2000 - 300 - 250 + 1000);
    expect(cf.endingCash).toBe(1500 + 2450);
    expect(cf.difference).toBe(0);
  });
});

describe("transactionsForLine", () => {
  it("returns the transactions behind an account, a disposition, or pending evidence", () => {
    const a = txn(10, "business_income");
    const b = txn(-5, "business_expense", "amex", "unmatched");
    const cUnassigned = txn(-7, "owner_draw", null);
    const all = [a, b, cUnassigned];
    expect(transactionsForLine("account:amex", all, [checking, card], false)).toEqual([b]);
    expect(transactionsForLine("account:unassigned", all, [checking, card], false)).toEqual([cUnassigned]);
    expect(transactionsForLine("awaiting_evidence", all, [checking, card], false)).toEqual([b]);
    expect(transactionsForLine("business_expense", all, [checking, card], true)).toEqual([]); // card is not cash
    expect(transactionsForLine("net_income", all, [checking, card], false)).toEqual([]);
  });
});

describe("date helpers", () => {
  it("steps across month and year ends", () => {
    expect(dayAfter("2025-12-31")).toBe("2026-01-01");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });
});
