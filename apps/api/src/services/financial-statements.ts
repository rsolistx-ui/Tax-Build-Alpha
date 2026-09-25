import type { Db } from "../db";
import type { AnyDisposition } from "./pnl";
import { assemblePnlReport, isAccrualUnsupported } from "./reporting";

/**
 * Per-client balance sheet and cash flow statement, cash basis, built from the
 * client's money accounts (client_accounts, opening balances as of the books
 * start date) and the same bank transaction classifications the P&L uses.
 *
 * Net income always comes from assemblePnlReport, so these statements never
 * disagree with the P&L. Money that moved without a matching P&L entry (receipts
 * paid outside the business accounts, spending still waiting for evidence,
 * unclassified activity) gets its own line, so the balance sheet balances by
 * construction and every gap stays visible instead of hidden in a plug.
 *
 * Amounts are the signed bank amounts used everywhere else: negative is money
 * out of the account, positive is money in.
 */

export type AccountKind = "checking" | "savings" | "credit_card" | "loan";
export const ACCOUNT_KINDS: AccountKind[] = ["checking", "savings", "credit_card", "loan"];
/** Kinds whose balance is cash the business holds; the others are owed. */
const CASH_KINDS = new Set<AccountKind>(["checking", "savings"]);
/** Kinds bank activity can be assigned to. A loan's payments come through a cash account, classified loan. */
export const ASSIGNABLE_KINDS = new Set<AccountKind>(["checking", "savings", "credit_card"]);

export type StatementAccount = { id: string; name: string; kind: AccountKind; openingBalance: number };
export type StatementTxn = {
  id: string;
  date: string;
  amount: number;
  disposition: AnyDisposition;
  /** The P&L counts this spending: marked no receipt required, or matched to a receipt that is filed. */
  evidenced: boolean;
  accountId: string | null;
  description: string | null;
};

export type StatementLine = { key: string; label: string; amount: number; count?: number; review?: boolean };

const UNASSIGNED = "account:unassigned";
const round = (n: number) => Math.round(n * 100) / 100 || 0; // "|| 0" turns -0 into 0
const sum = (txns: StatementTxn[]) => round(txns.reduce((s, t) => s + t.amount, 0));
const withDisposition = (txns: StatementTxn[], d: AnyDisposition) => txns.filter((t) => t.disposition === d);
const awaitingEvidence = (t: StatementTxn) => t.disposition === "business_expense" && !t.evidenced;
/** With exactly one loan account, loan payments and proceeds belong to it; with several they stay on one shared line. */
const soleLoanId = (accounts: StatementAccount[]) => {
  const loans = accounts.filter((a) => a.kind === "loan");
  return loans.length === 1 ? loans[0].id : null;
};

function isCashTxn(t: StatementTxn, accounts: Map<string, StatementAccount>): boolean {
  if (!t.accountId) return true; // Unassigned activity came from a bank CSV; it is counted as cash until assigned.
  const account = accounts.get(t.accountId);
  return !account || CASH_KINDS.has(account.kind);
}

/** Transactions behind a statement line, for drill-down. Lines built from the P&L or opening balances have none. */
export function transactionsForLine(key: string, txns: StatementTxn[], accounts: StatementAccount[], cashOnly: boolean): StatementTxn[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const pool = cashOnly ? txns.filter((t) => isCashTxn(t, byId)) : txns;
  if (key === UNASSIGNED) return pool.filter((t) => !t.accountId);
  if (key.startsWith("account:")) {
    const id = key.slice("account:".length);
    return id === soleLoanId(accounts) ? withDisposition(pool, "loan") : pool.filter((t) => t.accountId === id);
  }
  if (key === "awaiting_evidence") return pool.filter(awaitingEvidence);
  const byKey: Record<string, AnyDisposition> = {
    transfers: "transfer", loans: "loan", owner_contribution: "owner_contribution", owner_draw: "owner_draw",
    personal: "personal", other_excluded: "other_excluded", unclassified: "unclassified",
    business_income: "business_income", business_expense: "business_expense",
  };
  const disposition = byKey[key];
  return disposition ? withDisposition(pool, disposition) : [];
}

export type BalanceSheet = {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totals: { assets: number; liabilities: number; equity: number; liabilitiesAndEquity: number; difference: number };
};

/**
 * @param txns every counted transaction from the books start through the as-of date
 * @param netIncomePriorYears P&L net from the books start through the end of the prior year
 * @param netIncomeThisYear P&L net for the as-of date's year (from the books start if later)
 * @param receiptsPaidOutside filed receipts in the same window not tied to any bank transaction (P&L expense paid some other way)
 */
export function computeBalanceSheet(
  accounts: StatementAccount[],
  txns: StatementTxn[],
  netIncomePriorYears: number,
  netIncomeThisYear: number,
  receiptsPaidOutside = 0,
): BalanceSheet {
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const loans = withDisposition(txns, "loan");
  const loanAccountId = soleLoanId(accounts);
  for (const account of accounts) {
    if (account.id === loanAccountId) {
      // Proceeds (money in) raise what is owed; payments (money out) lower it.
      liabilities.push({ key: `account:${account.id}`, label: account.name, count: loans.length, amount: round(account.openingBalance + sum(loans)) });
      continue;
    }
    const own = txns.filter((t) => t.accountId === account.id);
    const line = { key: `account:${account.id}`, label: account.name, count: own.length };
    if (CASH_KINDS.has(account.kind)) assets.push({ ...line, amount: round(account.openingBalance + sum(own)) });
    else liabilities.push({ ...line, amount: round(account.openingBalance - sum(own)) });
  }
  const unassigned = txns.filter((t) => !t.accountId);
  if (unassigned.length > 0) {
    assets.push({ key: UNASSIGNED, label: "Bank activity not assigned to an account", amount: sum(unassigned), count: unassigned.length, review: true });
  }
  const transfers = withDisposition(txns, "transfer");
  if (transfers.length > 0 && sum(transfers) !== 0) {
    assets.push({ key: "transfers", label: "Transfers to or from accounts not in the books", amount: round(-sum(transfers)), count: transfers.length, review: true });
  }
  if (loans.length > 0 && !loanAccountId) {
    const label = accounts.some((a) => a.kind === "loan") ? "Loan proceeds less payments, all loans (not split by loan)" : "Loan proceeds less payments (classified loan)";
    liabilities.push({ key: "loans", label, amount: sum(loans), count: loans.length });
  }

  const openingEquity = round(accounts.reduce((s, a) => s + (CASH_KINDS.has(a.kind) ? a.openingBalance : -a.openingBalance), 0));
  const business = [...withDisposition(txns, "business_income"), ...withDisposition(txns, "business_expense")];
  const pending = txns.filter(awaitingEvidence);
  const netIncome = round(netIncomePriorYears + netIncomeThisYear);
  // What the P&L counted that did not move through these accounts: receipts paid some other way, and
  // the rest (a receipt dated in a different period than its bank payment, or a different amount).
  const paidOutside = round(receiptsPaidOutside);
  const differences = round(sum(business) - sum(pending) - netIncome - paidOutside);
  const byDisposition = (key: string, label: string, d: AnyDisposition, review = false): StatementLine | null => {
    const rows = withDisposition(txns, d);
    return rows.length > 0 ? { key, label, amount: sum(rows), count: rows.length, ...(review ? { review } : {}) } : null;
  };
  const equity = [
    { key: "opening", label: "Opening balance equity", amount: openingEquity },
    byDisposition("owner_contribution", "Owner contributions", "owner_contribution"),
    byDisposition("owner_draw", "Owner draws", "owner_draw"),
    byDisposition("personal", "Personal spending from business accounts", "personal"),
    byDisposition("other_excluded", "Other excluded activity", "other_excluded"),
    { key: "retained", label: "Retained earnings (prior years)", amount: round(netIncomePriorYears) },
    { key: "net_income", label: "Net income this year (matches the P&L)", amount: round(netIncomeThisYear) },
    paidOutside !== 0 ? { key: "paid_outside", label: "Receipts paid outside the business accounts (owner funded)", amount: paidOutside } : null,
    differences !== 0 ? { key: "differences", label: "Receipt and bank timing or amount differences", amount: differences, review: true } : null,
    pending.length > 0 ? { key: "awaiting_evidence", label: "Business spending awaiting receipt evidence", amount: sum(pending), count: pending.length, review: true } : null,
    byDisposition("unclassified", "Unclassified bank activity", "unclassified", true),
  ].filter((line): line is StatementLine => line !== null);

  const total = (lines: StatementLine[]) => round(lines.reduce((s, l) => s + l.amount, 0));
  const totals = { assets: total(assets), liabilities: total(liabilities), equity: total(equity), liabilitiesAndEquity: 0, difference: 0 };
  totals.liabilitiesAndEquity = round(totals.liabilities + totals.equity);
  totals.difference = round(totals.assets - totals.liabilitiesAndEquity);
  return { assets, liabilities, equity, totals };
}

export type CashFlowStatement = {
  beginningCash: number;
  operating: StatementLine[];
  financing: StatementLine[];
  transfers: StatementLine[];
  review: StatementLine[];
  netChange: number;
  endingCash: number;
  /** Beginning cash plus the period's lines minus ending cash; zero unless something is wrong. */
  difference: number;
};

/**
 * Direct method. Cash is checking, savings and unassigned bank activity; spending on a
 * credit card moves no cash until the card is paid, which shows as a transfer.
 * @param before counted transactions from the books start through the day before the period
 * @param during counted transactions inside the period
 */
export function computeCashFlow(accounts: StatementAccount[], before: StatementTxn[], during: StatementTxn[]): CashFlowStatement {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const openingCash = accounts.filter((a) => CASH_KINDS.has(a.kind)).reduce((s, a) => s + a.openingBalance, 0);
  const beginningCash = round(openingCash + sum(before.filter((t) => isCashTxn(t, byId))));
  const cash = during.filter((t) => isCashTxn(t, byId));
  const line = (key: string, label: string, d: AnyDisposition, review = false): StatementLine | null => {
    const rows = withDisposition(cash, d);
    return rows.length > 0 ? { key, label, amount: sum(rows), count: rows.length, ...(review ? { review } : {}) } : null;
  };
  const present = (lines: Array<StatementLine | null>) => lines.filter((l): l is StatementLine => l !== null);
  const operating = present([
    line("business_income", "Received from business income", "business_income"),
    line("business_expense", "Paid for business expenses", "business_expense"),
  ]);
  const financing = present([
    line("owner_contribution", "Owner contributions", "owner_contribution"),
    line("owner_draw", "Owner draws", "owner_draw"),
    line("personal", "Personal spending from business accounts", "personal"),
    line("other_excluded", "Other excluded activity", "other_excluded"),
    line("loans", "Loan proceeds less payments", "loan"),
  ]);
  const transfers = present([line("transfers", "Credit card payments and transfers to accounts not in the books", "transfer")]);
  const review = present([line("unclassified", "Unclassified bank activity", "unclassified", true)]);
  const netChange = sum(cash);
  const endingCash = round(openingCash + sum(before.filter((t) => isCashTxn(t, byId))) + netChange);
  const listed = round([...operating, ...financing, ...transfers, ...review].reduce((s, l) => s + l.amount, 0));
  return { beginningCash, operating, financing, transfers, review, netChange, endingCash, difference: round(beginningCash + listed - endingCash) };
}

export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type StatementBooks = {
  currency: string;
  accrual: boolean;
  booksStartDate: string | null;
  accounts: StatementAccount[];
  /** Counted transactions: dated, in the client's currency, after the books start date. */
  txns: StatementTxn[];
  excluded: { otherCurrency: number; undated: number; beforeBooksStart: number };
};

export async function loadStatementBooks(db: Db, clientId: string): Promise<StatementBooks> {
  const [profile] = await db.query<{ accounting_basis: string | null; default_currency: string | null; books_start_date: string | null }>(
    `SELECT accounting_basis, default_currency, books_start_date::text AS books_start_date FROM client_profiles WHERE client_id = $1`,
    [clientId],
  );
  const currency = (profile?.default_currency || "USD").toUpperCase();
  const booksStartDate = profile?.books_start_date ?? null;
  const [accountRows, txnRows] = await Promise.all([
    db.query<{ id: string; name: string; kind: AccountKind; opening_balance: string }>(
      `SELECT id, name, kind, opening_balance FROM client_accounts WHERE client_id = $1 ORDER BY kind, lower(name)`,
      [clientId],
    ),
    db.query<{ id: string; txn_date: string | null; amount: string; currency: string | null; disposition: AnyDisposition; evidenced: boolean; account_id: string | null; description: string | null }>(
      `SELECT bt.id, bt.txn_date::text AS txn_date, bt.amount, bt.currency, bt.disposition, bt.account_id, bt.description,
              (bt.triage = 'no_receipt_required' OR (bt.triage = 'matched' AND r.status = 'filed')) IS TRUE AS evidenced
         FROM bank_transactions bt
         LEFT JOIN receipts r ON r.id = bt.matched_receipt_id AND r.client_id = bt.client_id
        WHERE bt.client_id = $1 ORDER BY bt.txn_date, bt.id`,
      [clientId],
    ),
  ]);
  const excluded = { otherCurrency: 0, undated: 0, beforeBooksStart: 0 };
  const txns: StatementTxn[] = [];
  for (const row of txnRows) {
    if ((row.currency || "USD").toUpperCase() !== currency) { excluded.otherCurrency += 1; continue; }
    if (!row.txn_date) { excluded.undated += 1; continue; }
    if (booksStartDate && row.txn_date <= booksStartDate) { excluded.beforeBooksStart += 1; continue; }
    txns.push({
      id: row.id, date: row.txn_date, amount: Number(row.amount ?? 0), disposition: row.disposition,
      evidenced: row.evidenced === true, accountId: row.account_id, description: row.description,
    });
  }
  return {
    currency,
    accrual: profile?.accounting_basis === "accrual",
    booksStartDate,
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, openingBalance: Number(a.opening_balance) })),
    txns,
    excluded,
  };
}

async function pnlNet(db: Db, clientId: string, start: string | null, end: string): Promise<number> {
  if (start && start > end) return 0;
  const report = await assemblePnlReport(db, clientId, start, end);
  return isAccrualUnsupported(report) ? 0 : report.net;
}

export async function buildBalanceSheet(db: Db, clientId: string, books: StatementBooks, asOf: string) {
  const firstCounted = books.booksStartDate ? dayAfter(books.booksStartDate) : null;
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const thisYearStart = firstCounted && firstCounted > yearStart ? firstCounted : yearStart;
  // Without a books start date the prior-year figure covers all earlier history, like the counted transactions.
  const [prior, current, [outside]] = await Promise.all([
    pnlNet(db, clientId, firstCounted, dayBefore(yearStart)),
    pnlNet(db, clientId, thisYearStart, asOf),
    // Filed receipts no bank transaction points at: the P&L counts them, and they were paid some other way.
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(r.extracted_total), 0)::text AS total FROM receipts r
        WHERE r.client_id = $1 AND r.status = 'filed' AND UPPER(r.extracted_currency) = UPPER($2)
          AND ($3::date IS NULL OR r.extracted_date >= $3::date) AND r.extracted_date <= $4::date
          AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.client_id = r.client_id
                            AND (bt.matched_receipt_id = r.id OR bt.pending_receipt_id = r.id))`,
      [clientId, books.currency, firstCounted, asOf],
    ),
  ]);
  const txns = books.txns.filter((t) => t.date <= asOf);
  return computeBalanceSheet(books.accounts, txns, prior, current, Number(outside?.total ?? 0));
}

export async function buildCashFlow(db: Db, clientId: string, books: StatementBooks, start: string, end: string) {
  const firstCounted = books.booksStartDate ? dayAfter(books.booksStartDate) : null;
  const periodStart = firstCounted && firstCounted > start ? firstCounted : start;
  const before = books.txns.filter((t) => t.date < periodStart);
  const during = books.txns.filter((t) => t.date >= periodStart && t.date <= end);
  const statement = computeCashFlow(books.accounts, before, during);
  const netIncome = await pnlNet(db, clientId, periodStart, end);
  return { ...statement, periodStart, periodEnd: end, netIncome: round(netIncome) };
}
