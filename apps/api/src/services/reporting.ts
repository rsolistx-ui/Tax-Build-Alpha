/**
 * Report data assembly for the professional export center. This is a thin
 * database-access layer over the same pure accounting rules in ./pnl.ts -
 * it must never reimplement signed arithmetic, exclusion, or completeness
 * logic. The P&L route and the export routes both call assemblePnlReport so
 * a workbook's SUMMARY/P&L numbers always reconcile to the same numbers the
 * professional already sees on screen.
 */
import type { Db } from "../db";
import {
  filterByDateRange,
  selectBankExpenseTransactions,
  selectBankIncomeTransactions,
  sumBankExpenseAmount,
  sumBankIncomeAmount,
  mergeExpenseCategories,
  computeCompleteness,
  isAccrualBasisSupported,
  isCurrencyMismatch,
  isReceiptDispositionConflict,
  isReceiptCurrencyConflict,
  type BankTxnForPnl,
  type AnyDisposition,
} from "./pnl";

const CONFLICTING_DISPOSITIONS = [
  "personal",
  "transfer",
  "owner_contribution",
  "owner_draw",
  "loan",
  "other_excluded",
  "business_income",
] as const;
const CONFLICTING_DISPOSITIONS_SQL_LIST = CONFLICTING_DISPOSITIONS.map((d) => `'${d}'`).join(", ");

const EXCLUDED_NONBUSINESS_DISPOSITIONS = [
  "personal",
  "transfer",
  "owner_contribution",
  "owner_draw",
  "loan",
  "other_excluded",
] as const;
const EXCLUDED_NONBUSINESS_SQL_LIST = EXCLUDED_NONBUSINESS_DISPOSITIONS.map((d) => `'${d}'`).join(", ");

const UNRESOLVED_TRIAGE_SQL_LIST = ["unmatched", "needs_review", "likely_match", "receipt_pending"]
  .map((t) => `'${t}'`)
  .join(", ");

const expenseLinesCte = `
WITH line_sums AS (
  SELECT
    r.id AS receipt_id,
    COALESCE(SUM(COALESCE(li.amount, 0)), 0)::numeric AS line_sum,
    COUNT(li.id)::int AS line_count
  FROM receipts r
  LEFT JOIN receipt_line_items li ON li.receipt_id = r.id
  WHERE r.client_id = $1 AND r.status = 'filed'
  GROUP BY r.id
),
receipt_conflict AS (
  SELECT r.id AS receipt_id
  FROM receipts r
  JOIN bank_transactions bt ON bt.matched_receipt_id = r.id AND bt.client_id = r.client_id
  WHERE bt.disposition IN (${CONFLICTING_DISPOSITIONS_SQL_LIST})
),
expense_lines AS (
  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    li.line_no,
    li.description,
    COALESCE(cat_li.id, r.category_id) AS category_id,
    COALESCE(cat_li.name, cat_receipt.name, 'Uncategorized') AS category,
    COALESCE(li.amount, 0)::numeric AS amount
  FROM receipts r
  JOIN receipt_line_items li ON li.receipt_id = r.id
  LEFT JOIN categories cat_li ON cat_li.client_id = r.client_id
    AND (LOWER(cat_li.slug) = LOWER(NULLIF(li.category, '')) OR LOWER(cat_li.name) = LOWER(NULLIF(li.category, '')))
  LEFT JOIN categories cat_receipt ON cat_receipt.id = r.category_id
  WHERE r.client_id = $1 AND r.status = 'filed'
    AND UPPER(r.extracted_currency) = UPPER($4)
    AND NOT EXISTS (SELECT 1 FROM receipt_conflict rc WHERE rc.receipt_id = r.id)
    AND ($2::date IS NULL OR r.extracted_date >= $2::date)
    AND ($3::date IS NULL OR r.extracted_date <= $3::date)

  UNION ALL

  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    NULL::integer AS line_no,
    '(receipt-level adjustment)' AS description,
    r.category_id AS category_id,
    COALESCE(cat_receipt.name, 'Uncategorized') AS category,
    (COALESCE(r.extracted_total, s.line_sum) - s.line_sum)::numeric AS amount
  FROM receipts r
  JOIN line_sums s ON s.receipt_id = r.id
  LEFT JOIN categories cat_receipt ON cat_receipt.id = r.category_id
  WHERE r.client_id = $1
    AND r.status = 'filed'
    AND UPPER(r.extracted_currency) = UPPER($4)
    AND s.line_count > 0
    AND ABS(COALESCE(r.extracted_total, s.line_sum) - s.line_sum) > 0.004
    AND NOT EXISTS (SELECT 1 FROM receipt_conflict rc WHERE rc.receipt_id = r.id)
    AND ($2::date IS NULL OR r.extracted_date >= $2::date)
    AND ($3::date IS NULL OR r.extracted_date <= $3::date)

  UNION ALL

  SELECT
    r.id AS receipt_id,
    r.extracted_date AS txn_date,
    r.extracted_merchant AS merchant,
    r.filename,
    NULL::integer AS line_no,
    '(receipt total)' AS description,
    r.category_id AS category_id,
    COALESCE(cat_receipt.name, 'Uncategorized') AS category,
    COALESCE(r.extracted_total, 0)::numeric AS amount
  FROM receipts r
  JOIN line_sums s ON s.receipt_id = r.id
  LEFT JOIN categories cat_receipt ON cat_receipt.id = r.category_id
  WHERE r.client_id = $1
    AND r.status = 'filed'
    AND UPPER(r.extracted_currency) = UPPER($4)
    AND s.line_count = 0
    AND NOT EXISTS (SELECT 1 FROM receipt_conflict rc WHERE rc.receipt_id = r.id)
    AND ($2::date IS NULL OR r.extracted_date >= $2::date)
    AND ($3::date IS NULL OR r.extracted_date <= $3::date)
)`;

export type PnlReport = {
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  accountingBasis: string;
  accrualSupported: boolean;
  income: number;
  expenses: number;
  net: number;
  categorizedExpenses: ReturnType<typeof mergeExpenseCategories>;
  categorizedIncome: Array<{ categoryId: string | null; category: string; count: number; total: number }>;
  counts: {
    filedReceipts: number;
    matchedBankTransactions: number;
    noReceiptBusinessExpenses: number;
    businessIncomeTransactions: number;
  };
  completeness: ReturnType<typeof computeCompleteness>;
  excludedFiledReceiptCount: number;
  excludedFiledReceipts: Array<{
    receiptId: string;
    merchant: string | null;
    date: string | null;
    amount: number | null;
    filename: string;
    bankTransactionId: string;
    bankDisposition: AnyDisposition;
    sourceUrl: string;
  }>;
  note: string;
};

export type AccrualUnsupported = {
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  accountingBasis: "accrual";
  accrualSupported: false;
  warning: string;
};

/**
 * Moved verbatim (same queries, same signed-accounting rules from ./pnl.ts)
 * out of the P&L route so the export center can call the exact same
 * assembly the professional already sees, rather than a second parallel
 * implementation.
 */
export async function assemblePnlReport(
  db: Db,
  clientId: string,
  startDate: string | null,
  endDate: string | null,
): Promise<PnlReport | AccrualUnsupported> {
  const [profile] = await db.query<{ accounting_basis: string | null; default_currency: string }>(
    `SELECT accounting_basis, default_currency FROM client_profiles WHERE client_id = $1`,
    [clientId],
  );
  const clientCurrency = (profile?.default_currency || "USD").toUpperCase();

  if (!isAccrualBasisSupported(profile?.accounting_basis ?? null)) {
    return {
      periodStart: startDate,
      periodEnd: endDate,
      currency: clientCurrency,
      accountingBasis: "accrual",
      accrualSupported: false,
      warning:
        "Accrual-basis reporting is not supported yet. This client is configured for accrual accounting, so no P&L is generated here. Switch the client to cash basis to use the operational P&L, or wait for accrual support.",
    };
  }

  const receiptRows = await db.query<{ category_id: string | null; category: string; count: number; receipt_count: number; total: number }>(
    `${expenseLinesCte}
     SELECT category_id, category, COUNT(*)::int AS count, COUNT(DISTINCT receipt_id)::int AS receipt_count,
            COALESCE(SUM(amount), 0)::numeric AS total
     FROM expense_lines
     GROUP BY category_id, category
     ORDER BY total DESC, category`,
    [clientId, startDate, endDate, clientCurrency],
  );
  const receiptExpenseTotal = receiptRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const uncategorizedReceiptLineCount = receiptRows
    .filter((row) => row.category_id === null)
    .reduce((sum, row) => sum + Number(row.count || 0), 0);

  const filedReceiptCountResult = await db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT r.id)::text AS count
     FROM receipts r
     WHERE r.client_id = $1 AND r.status = 'filed' AND UPPER(r.extracted_currency) = UPPER($4)
       AND ($2::date IS NULL OR r.extracted_date >= $2::date)
       AND ($3::date IS NULL OR r.extracted_date <= $3::date)`,
    [clientId, startDate, endDate, clientCurrency],
  );
  const filedReceiptCount = parseInt(filedReceiptCountResult[0]?.count || "0", 10);

  const receiptCurrencyConflictResult = await db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT r.id)::text AS count
     FROM receipts r
     WHERE r.client_id = $1 AND r.status = 'filed' AND UPPER(r.extracted_currency) != UPPER($4)
       AND NOT EXISTS (
         SELECT 1 FROM bank_transactions bt
         WHERE bt.matched_receipt_id = r.id AND bt.client_id = r.client_id
           AND bt.disposition IN (${CONFLICTING_DISPOSITIONS_SQL_LIST})
       )
       AND ($2::date IS NULL OR r.extracted_date >= $2::date)
       AND ($3::date IS NULL OR r.extracted_date <= $3::date)`,
    [clientId, startDate, endDate, clientCurrency],
  );
  const receiptCurrencyConflictCount = parseInt(receiptCurrencyConflictResult[0]?.count || "0", 10);

  const excludedReceiptRows = await db.query<{
    receipt_id: string;
    merchant: string | null;
    date: string | null;
    amount: number | null;
    filename: string;
    bank_transaction_id: string;
    bank_disposition: AnyDisposition;
  }>(
    `SELECT r.id AS receipt_id, r.extracted_merchant AS merchant, r.extracted_date AS date,
            r.extracted_total AS amount, r.filename, bt.id AS bank_transaction_id, bt.disposition AS bank_disposition
     FROM receipts r
     JOIN bank_transactions bt ON bt.matched_receipt_id = r.id AND bt.client_id = r.client_id
     WHERE r.client_id = $1 AND r.status = 'filed'
       AND bt.disposition IN (${CONFLICTING_DISPOSITIONS_SQL_LIST})
       AND ($2::date IS NULL OR r.extracted_date >= $2::date)
       AND ($3::date IS NULL OR r.extracted_date <= $3::date)
     ORDER BY r.extracted_date DESC NULLS LAST`,
    [clientId, startDate, endDate],
  );
  const excludedFiledReceipts = excludedReceiptRows.map((row) => ({
    receiptId: row.receipt_id,
    merchant: row.merchant,
    date: row.date,
    amount: row.amount === null ? null : Number(row.amount),
    filename: row.filename,
    bankTransactionId: row.bank_transaction_id,
    bankDisposition: row.bank_disposition,
    sourceUrl: `/api/clients/${clientId}/receipts/${row.receipt_id}/source`,
  }));

  const bankRows = await db.query<{
    id: string;
    txn_date: string | null;
    amount: number;
    disposition: AnyDisposition;
    triage: string;
    category_id: string | null;
    category_name: string | null;
    currency: string;
  }>(
    `SELECT bt.id, bt.txn_date, bt.amount, bt.disposition, bt.triage, bt.category_id, cat.name AS category_name, bt.currency
     FROM bank_transactions bt
     LEFT JOIN categories cat ON cat.id = bt.category_id AND cat.client_id = bt.client_id
     WHERE bt.client_id = $1`,
    [clientId],
  );
  const bankTxns: BankTxnForPnl[] = bankRows.map((row) => ({
    id: row.id,
    date: row.txn_date ? String(row.txn_date) : null,
    amount: Number(row.amount ?? 0),
    disposition: row.disposition,
    triage: row.triage,
    categoryId: row.category_id,
    categoryName: row.category_name,
    currency: (row.currency || "USD").toUpperCase(),
  }));

  const bankTxnsInRangeAllCurrencies = filterByDateRange(bankTxns, startDate, endDate);
  const bankTxnsInRange = bankTxnsInRangeAllCurrencies.filter((t) => !isCurrencyMismatch(t.currency, clientCurrency));

  const bankExpenseTxns = selectBankExpenseTransactions(bankTxnsInRange);
  const bankIncomeTxns = selectBankIncomeTransactions(bankTxnsInRange);
  const bankExpenseTotal = sumBankExpenseAmount(bankExpenseTxns);
  const income = sumBankIncomeAmount(bankIncomeTxns);
  const expenses = receiptExpenseTotal + bankExpenseTotal;

  const bankExpenseByCategory = new Map<string, { categoryId: string | null; category: string; count: number; total: number }>();
  for (const txn of bankExpenseTxns) {
    const key = txn.categoryId ?? "__uncategorized__";
    const existing = bankExpenseByCategory.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += -Number(txn.amount);
    } else {
      bankExpenseByCategory.set(key, {
        categoryId: txn.categoryId,
        category: txn.categoryName || "Uncategorized",
        count: 1,
        total: -Number(txn.amount),
      });
    }
  }

  const bankIncomeByCategory = new Map<string, { categoryId: string | null; category: string; count: number; total: number }>();
  for (const txn of bankIncomeTxns) {
    const key = txn.categoryId ?? "__uncategorized__";
    const existing = bankIncomeByCategory.get(key);
    if (existing) {
      existing.count += 1;
      existing.total += Number(txn.amount);
    } else {
      bankIncomeByCategory.set(key, {
        categoryId: txn.categoryId,
        category: txn.categoryName || "Uncategorized",
        count: 1,
        total: Number(txn.amount),
      });
    }
  }

  const categorizedExpenses = mergeExpenseCategories(
    receiptRows.map((row) => ({
      categoryId: row.category_id,
      category: row.category,
      count: Number(row.count),
      receiptCount: Number(row.receipt_count),
      total: Number(row.total),
    })),
    Array.from(bankExpenseByCategory.values()),
  );
  const categorizedIncome = Array.from(bankIncomeByCategory.values()).sort((a, b) => b.total - a.total);

  const completeness = computeCompleteness({
    transactions: bankTxnsInRangeAllCurrencies.map((t) => ({
      disposition: t.disposition,
      triage: t.triage,
      categoryId: t.categoryId,
      currency: t.currency,
    })),
    clientCurrency,
    uncategorizedReceiptLineCount,
    receiptCurrencyConflictCount,
  });
  const matchedBankTransactionCount = bankTxnsInRange.filter((t) => t.triage === "matched").length;

  return {
    periodStart: startDate,
    periodEnd: endDate,
    currency: clientCurrency,
    accountingBasis: profile?.accounting_basis ?? "cash",
    accrualSupported: true,
    income,
    expenses,
    net: income - expenses,
    categorizedExpenses,
    categorizedIncome,
    counts: {
      filedReceipts: filedReceiptCount,
      matchedBankTransactions: matchedBankTransactionCount,
      noReceiptBusinessExpenses: bankExpenseTxns.length,
      businessIncomeTransactions: bankIncomeTxns.length,
    },
    completeness,
    excludedFiledReceiptCount: excludedFiledReceipts.length,
    excludedFiledReceipts,
    note: "Business income comes only from bank transactions explicitly classified business income. Business expenses combine filed receipt evidence with deliberately no-receipt bank transactions explicitly classified business expense. Personal, transfer, owner, loan, other-excluded, and unclassified activity are excluded. A filed receipt whose matched bank transaction was explicitly classified as personal, transfer, owner, loan, other-excluded, or business income is excluded from expenses; see excludedFiledReceipts for the affected evidence. Activity in a currency other than the client's configured currency is excluded and counted as a currency conflict.",
  };
}

/**
 * Canonical per-client count of uncategorized filed-receipt lines. Every
 * surface that must reconcile with P&L completeness (dashboard, client
 * overview, tax readiness) calls this instead of approximating with zero -
 * one query for any number of clients, never one query per client.
 */
export async function getUncategorizedReceiptLineCounts(db: Db, clientIds: string[]): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const rows = await db.query<{ client_id: string; count: string }>(
    `WITH receipt_conflict AS (
       SELECT r.id AS receipt_id
       FROM receipts r
       JOIN bank_transactions bt ON bt.matched_receipt_id = r.id AND bt.client_id = r.client_id
       WHERE bt.disposition IN (${CONFLICTING_DISPOSITIONS_SQL_LIST})
     )
     SELECT r.client_id, COUNT(*)::text AS count
     FROM receipts r
     JOIN receipt_line_items li ON li.receipt_id = r.id
     JOIN client_profiles cp ON cp.client_id = r.client_id
     LEFT JOIN categories cat_li ON cat_li.client_id = r.client_id
       AND (LOWER(cat_li.slug) = LOWER(NULLIF(li.category, '')) OR LOWER(cat_li.name) = LOWER(NULLIF(li.category, '')))
     LEFT JOIN categories cat_receipt ON cat_receipt.id = r.category_id
     WHERE r.client_id IN (SELECT jsonb_array_elements_text($1::jsonb))
       AND r.status = 'filed'
       AND UPPER(r.extracted_currency) = UPPER(cp.default_currency)
       AND COALESCE(cat_li.id, cat_receipt.id, r.category_id) IS NULL
       AND NOT EXISTS (SELECT 1 FROM receipt_conflict rc WHERE rc.receipt_id = r.id)
     GROUP BY r.client_id`,
    [clientIds],
  );
  return new Map(rows.map((r) => [r.client_id, parseInt(r.count, 10)]));
}

export function isAccrualUnsupported(report: PnlReport | AccrualUnsupported): report is AccrualUnsupported {
  return report.accrualSupported === false;
}

export type BankLedgerRow = {
  transactionId: string;
  date: string | null;
  description: string | null;
  amount: number;
  currency: string;
  disposition: AnyDisposition;
  category: string | null;
  professionalNote: string | null;
  triage: string;
  matchedReceiptStatus: string | null;
  matchedReceiptId: string | null;
  noReceiptReason: string | null;
  sourceFilename: string | null;
  sourceRow: number | null;
  importBatchId: string | null;
};

/**
 * Every bank transaction in the period regardless of disposition. The P&L
 * excludes personal/transfer/owner/loan/other-excluded/unclassified
 * activity from operating totals, but the professional ledger must remain
 * complete so nothing reviewed is ever silently omitted from the export.
 */
export async function getBankLedger(db: Db, clientId: string, startDate: string | null, endDate: string | null): Promise<BankLedgerRow[]> {
  const rows = await db.query<{
    id: string;
    txn_date: string | null;
    description: string | null;
    amount: number;
    currency: string;
    disposition: AnyDisposition;
    category_name: string | null;
    disposition_note: string | null;
    triage: string;
    matched_receipt_id: string | null;
    matched_receipt_status: string | null;
    resolution_reason: string | null;
    raw_json: unknown;
  }>(
    `SELECT bt.id, bt.txn_date, bt.description, bt.amount, bt.currency, bt.disposition,
            cat.name AS category_name, bt.disposition_note, bt.triage,
            bt.matched_receipt_id, mr.status AS matched_receipt_status,
            bt.resolution_reason, bt.raw_json
     FROM bank_transactions bt
     LEFT JOIN categories cat ON cat.id = bt.category_id AND cat.client_id = bt.client_id
     LEFT JOIN receipts mr ON mr.id = bt.matched_receipt_id
     WHERE bt.client_id = $1
       AND ($2::date IS NULL OR bt.txn_date >= $2::date)
       AND ($3::date IS NULL OR bt.txn_date <= $3::date)
     ORDER BY bt.txn_date DESC NULLS LAST, bt.id`,
    [clientId, startDate, endDate],
  );
  return rows.map((row) => {
    const raw = (row.raw_json ?? {}) as { importBatchId?: string; sourceFilename?: string; sourceRow?: number };
    return {
      transactionId: row.id,
      date: row.txn_date ? String(row.txn_date) : null,
      description: row.description,
      amount: Number(row.amount ?? 0),
      currency: (row.currency || "USD").toUpperCase(),
      disposition: row.disposition,
      category: row.category_name,
      professionalNote: row.disposition_note,
      triage: row.triage,
      matchedReceiptStatus: row.matched_receipt_status,
      matchedReceiptId: row.matched_receipt_id,
      noReceiptReason: row.resolution_reason,
      sourceFilename: raw.sourceFilename ?? null,
      sourceRow: typeof raw.sourceRow === "number" ? raw.sourceRow : null,
      importBatchId: raw.importBatchId ?? null,
    };
  });
}

export type ReceiptEvidenceRow = {
  receiptId: string;
  date: string | null;
  merchant: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  currency: string;
  category: string | null;
  filename: string;
  validationStatus: string;
  excludedFromOperatingPnl: boolean;
  exclusionReason: string | null;
  matchedBankTransactionId: string | null;
  sourceUrl: string;
};

/** Every filed receipt in the period, independent of currency or exclusion, for full evidentiary traceability. */
export async function getReceiptEvidence(db: Db, clientId: string, startDate: string | null, endDate: string | null): Promise<ReceiptEvidenceRow[]> {
  const [profile] = await db.query<{ default_currency: string }>(
    `SELECT default_currency FROM client_profiles WHERE client_id = $1`,
    [clientId],
  );
  const clientCurrency = (profile?.default_currency || "USD").toUpperCase();

  const rows = await db.query<{
    id: string;
    extracted_date: string | null;
    extracted_merchant: string | null;
    extracted_subtotal: number | null;
    extracted_tax: number | null;
    extracted_tip: number | null;
    extracted_total: number | null;
    extracted_currency: string;
    category_name: string | null;
    filename: string;
    validation_status: string;
    matched_bank_id: string | null;
    matched_bank_disposition: AnyDisposition | null;
  }>(
    `SELECT r.id, r.extracted_date, r.extracted_merchant, r.extracted_subtotal, r.extracted_tax, r.extracted_tip,
            r.extracted_total, r.extracted_currency, cat.name AS category_name, r.filename, r.validation_status,
            bt.id AS matched_bank_id, bt.disposition AS matched_bank_disposition
     FROM receipts r
     LEFT JOIN categories cat ON cat.id = r.category_id
     LEFT JOIN bank_transactions bt ON bt.matched_receipt_id = r.id AND bt.client_id = r.client_id
     WHERE r.client_id = $1 AND r.status = 'filed'
       AND ($2::date IS NULL OR r.extracted_date >= $2::date)
       AND ($3::date IS NULL OR r.extracted_date <= $3::date)
     ORDER BY r.extracted_date DESC NULLS LAST, r.id`,
    [clientId, startDate, endDate],
  );

  return rows.map((row) => {
    const currency = (row.extracted_currency || "USD").toUpperCase();
    const dispositionConflict = isReceiptDispositionConflict(row.matched_bank_disposition ?? null);
    const currencyConflict = isReceiptCurrencyConflict({
      receiptCurrency: currency,
      clientCurrency,
      matchedBankDisposition: row.matched_bank_disposition ?? null,
    });
    let exclusionReason: string | null = null;
    if (dispositionConflict) {
      exclusionReason = `Matched bank transaction disposition (${row.matched_bank_disposition}) conflicts with a business expense.`;
    } else if (currencyConflict) {
      exclusionReason = `Receipt currency ${currency} differs from the client's reporting currency ${clientCurrency}.`;
    }
    return {
      receiptId: row.id,
      date: row.extracted_date ? String(row.extracted_date) : null,
      merchant: row.extracted_merchant,
      subtotal: row.extracted_subtotal === null ? null : Number(row.extracted_subtotal),
      tax: row.extracted_tax === null ? null : Number(row.extracted_tax),
      tip: row.extracted_tip === null ? null : Number(row.extracted_tip),
      total: row.extracted_total === null ? null : Number(row.extracted_total),
      currency,
      category: row.category_name,
      filename: row.filename,
      validationStatus: row.validation_status,
      excludedFromOperatingPnl: dispositionConflict || currencyConflict,
      exclusionReason,
      matchedBankTransactionId: row.matched_bank_id,
      sourceUrl: `/api/clients/${clientId}/receipts/${row.id}/source`,
    };
  });
}

export type OpenItemRow = {
  kind:
    | "unclassified_bank_transaction"
    | "unresolved_bank_triage"
    | "uncategorized_business_activity"
    | "currency_conflict"
    | "receipt_bank_disposition_conflict";
  transactionId: string | null;
  receiptId: string | null;
  date: string | null;
  description: string;
  detail: string;
};

const UNRESOLVED_TRIAGE_STATES = new Set(["unmatched", "needs_review", "likely_match", "receipt_pending"]);

/**
 * Every selected-period item that still needs a professional decision.
 * Built from the same bank ledger and receipt evidence used elsewhere so
 * this list can never disagree with the completeness counts on the P&L.
 */
export async function getOpenItems(
  db: Db,
  clientId: string,
  startDate: string | null,
  endDate: string | null,
): Promise<OpenItemRow[]> {
  const [profile] = await db.query<{ default_currency: string }>(
    `SELECT default_currency FROM client_profiles WHERE client_id = $1`,
    [clientId],
  );
  const clientCurrency = (profile?.default_currency || "USD").toUpperCase();

  const [ledger, receipts] = await Promise.all([
    getBankLedger(db, clientId, startDate, endDate),
    getReceiptEvidence(db, clientId, startDate, endDate),
  ]);

  const items: OpenItemRow[] = [];
  const isBusinessDisposition = (d: AnyDisposition) => d === "business_expense" || d === "business_income";

  for (const txn of ledger) {
    if (txn.disposition === "unclassified") {
      items.push({
        kind: "unclassified_bank_transaction",
        transactionId: txn.transactionId,
        receiptId: null,
        date: txn.date,
        description: txn.description || "(no description)",
        detail: "This bank transaction has not been classified with a disposition yet.",
      });
      continue;
    }
    if (UNRESOLVED_TRIAGE_STATES.has(txn.triage)) {
      items.push({
        kind: "unresolved_bank_triage",
        transactionId: txn.transactionId,
        receiptId: null,
        date: txn.date,
        description: txn.description || "(no description)",
        detail: `This bank transaction's receipt-matching triage is still "${txn.triage}" and needs review.`,
      });
    }
    if (isBusinessDisposition(txn.disposition) && isCurrencyMismatch(txn.currency, clientCurrency)) {
      items.push({
        kind: "currency_conflict",
        transactionId: txn.transactionId,
        receiptId: null,
        date: txn.date,
        description: txn.description || "(no description)",
        detail: `This transaction is in ${txn.currency}, which differs from the client's reporting currency ${clientCurrency}.`,
      });
    } else if (isBusinessDisposition(txn.disposition) && !txn.category) {
      items.push({
        kind: "uncategorized_business_activity",
        transactionId: txn.transactionId,
        receiptId: null,
        date: txn.date,
        description: txn.description || "(no description)",
        detail: "This business transaction has not been assigned a category yet.",
      });
    }
  }

  for (const receipt of receipts) {
    if (!receipt.category) {
      items.push({
        kind: "uncategorized_business_activity",
        transactionId: null,
        receiptId: receipt.receiptId,
        date: receipt.date,
        description: receipt.merchant || receipt.filename,
        detail: "This filed receipt has not been assigned a category yet.",
      });
    }
    if (receipt.excludedFromOperatingPnl && receipt.exclusionReason?.includes("conflicts with a business expense")) {
      items.push({
        kind: "receipt_bank_disposition_conflict",
        transactionId: receipt.matchedBankTransactionId,
        receiptId: receipt.receiptId,
        date: receipt.date,
        description: receipt.merchant || receipt.filename,
        detail: receipt.exclusionReason,
      });
    } else if (receipt.excludedFromOperatingPnl && receipt.exclusionReason) {
      items.push({
        kind: "currency_conflict",
        transactionId: null,
        receiptId: receipt.receiptId,
        date: receipt.date,
        description: receipt.merchant || receipt.filename,
        detail: receipt.exclusionReason,
      });
    }
  }

  return items;
}

export type ExcludedNonbusinessRow = {
  transactionId: string;
  date: string | null;
  description: string | null;
  amount: number;
  currency: string;
  disposition: AnyDisposition;
  professionalNote: string | null;
};

/** Deliberate personal/transfer/owner/loan/other-excluded activity, proof it was reviewed rather than accidentally omitted. */
export async function getExcludedNonbusiness(
  db: Db,
  clientId: string,
  startDate: string | null,
  endDate: string | null,
): Promise<ExcludedNonbusinessRow[]> {
  const ledger = await getBankLedger(db, clientId, startDate, endDate);
  const excludedSet = new Set(EXCLUDED_NONBUSINESS_DISPOSITIONS as readonly string[]);
  return ledger
    .filter((row) => excludedSet.has(row.disposition))
    .map((row) => ({
      transactionId: row.transactionId,
      date: row.date,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      disposition: row.disposition,
      professionalNote: row.professionalNote,
    }));
}

export type TransactionReviewRow = {
  date: string | null;
  description: string | null;
  amount: number;
  currency: string;
  disposition: AnyDisposition;
  category: string | null;
  businessStatus: "business" | "nonbusiness" | "unclassified";
  matchedReceiptId: string | null;
  receiptFilename: string | null;
  professionalNote: string | null;
  sourceTransactionId: string;
  importBatchId: string | null;
};

function businessStatusFor(disposition: AnyDisposition): TransactionReviewRow["businessStatus"] {
  if (disposition === "business_expense" || disposition === "business_income") return "business";
  if (disposition === "unclassified") return "unclassified";
  return "nonbusiness";
}

/**
 * The professional reference worksheet: Folio's categorization and review
 * decisions laid out per transaction, so the professional can cross-check
 * or complete work in any other system by hand.
 */
export async function getTransactionReviewRows(
  db: Db,
  clientId: string,
  startDate: string | null,
  endDate: string | null,
): Promise<TransactionReviewRow[]> {
  const ledger = await getBankLedger(db, clientId, startDate, endDate);
  const receiptRows = await db.query<{ id: string; filename: string }>(
    `SELECT id, filename FROM receipts WHERE client_id = $1`,
    [clientId],
  );
  const filenameByReceiptId = new Map(receiptRows.map((r) => [r.id, r.filename]));

  return ledger.map((row) => ({
    date: row.date,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    disposition: row.disposition,
    category: row.category,
    businessStatus: businessStatusFor(row.disposition),
    matchedReceiptId: row.matchedReceiptId,
    receiptFilename: row.matchedReceiptId ? filenameByReceiptId.get(row.matchedReceiptId) ?? null : null,
    professionalNote: row.professionalNote,
    sourceTransactionId: row.transactionId,
    importBatchId: row.importBatchId,
  }));
}

export type ImportBatchSummary = {
  importBatchId: string | null;
  currency: string;
  transactionCount: number;
  earliestDate: string | null;
  latestDate: string | null;
};

/**
 * Distinct import-batch/currency groupings present in the period, so the UI
 * can force the professional to pick exactly one source/account grouping
 * for the Bank Transactions CSV rather than silently merging accounts.
 */
export async function listImportBatches(
  db: Db,
  clientId: string,
  startDate: string | null,
  endDate: string | null,
): Promise<ImportBatchSummary[]> {
  const ledger = await getBankLedger(db, clientId, startDate, endDate);
  const groups = new Map<string, ImportBatchSummary>();
  for (const row of ledger) {
    const key = `${row.importBatchId ?? "__none__"}::${row.currency}`;
    const existing = groups.get(key);
    if (existing) {
      existing.transactionCount += 1;
      if (row.date && (!existing.earliestDate || row.date < existing.earliestDate)) existing.earliestDate = row.date;
      if (row.date && (!existing.latestDate || row.date > existing.latestDate)) existing.latestDate = row.date;
    } else {
      groups.set(key, {
        importBatchId: row.importBatchId,
        currency: row.currency,
        transactionCount: 1,
        earliestDate: row.date,
        latestDate: row.date,
      });
    }
  }
  return Array.from(groups.values());
}
