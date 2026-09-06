export type PnlCategoryRow = { category: string; count: number; receiptCount: number; bankCount: number; total: number };
export type PnlIncomeCategoryRow = { category: string; count: number; total: number };

export type ExcludedFiledReceipt = {
  receiptId: string;
  merchant: string | null;
  date: string | null;
  amount: number | null;
  filename: string;
  bankTransactionId: string;
  bankDisposition: string;
  sourceUrl: string;
};

export type Pnl = {
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  accountingBasis?: "cash" | "accrual" | null;
  accrualSupported?: boolean;
  warning?: string;
  income?: number;
  expenses?: number;
  net?: number;
  categorizedExpenses?: PnlCategoryRow[];
  categorizedIncome?: PnlIncomeCategoryRow[];
  counts?: {
    filedReceipts: number;
    matchedBankTransactions: number;
    noReceiptBusinessExpenses: number;
    businessIncomeTransactions: number;
  };
  completeness?: {
    unclassifiedCount: number;
    unresolvedTriageCount: number;
    uncategorizedCount: number;
    currencyConflictCount: number;
    isComplete: boolean;
  };
  excludedFiledReceiptCount?: number;
  excludedFiledReceipts?: ExcludedFiledReceipt[];
  note?: string;
};

export type DrilldownEntry = {
  receiptId: string;
  date: string | null;
  merchant: string | null;
  filename: string;
  lineNo: number | null;
  description: string;
  amount: number;
  sourceUrl: string;
};

export type DrilldownBankEntry = {
  bankTransactionId: string;
  date: string | null;
  description: string;
  amount: number;
  noReceiptReason: string | null;
  note: string | null;
};

export type IncomeDrilldownEntry = {
  bankTransactionId: string;
  date: string | null;
  description: string | null;
  amount: number;
  reportedAmount: number;
  category: string;
  dispositionNote: string | null;
  sourceFilename: string | null;
  sourceRow: number | null;
  importBatchId: string | null;
  originalRow: unknown;
};

export type DrilldownState =
  | { type: "expense"; category: string; entries: DrilldownEntry[]; bankEntries: DrilldownBankEntry[] }
  | { type: "income"; category: string; entries: IncomeDrilldownEntry[] }
  | null;


export function buildDrilldownPath(
  clientId: string,
  category: string,
  type: "expense" | "income",
  startDate: string | null,
  endDate: string | null,
): string {
  const params = new URLSearchParams({ category, type });
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  return `/api/clients/${clientId}/pnl/drilldown?${params.toString()}`;
}
