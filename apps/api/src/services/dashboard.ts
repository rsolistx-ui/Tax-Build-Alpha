/**
 * Firm-wide operations dashboard assembly. This is a presentation layer over
 * the same canonical accounting/readiness rules in ./pnl.ts - it must never
 * invent a second definition of "unclassified", "unresolved", "uncategorized",
 * or "currency conflict". Every count here is built from the same predicates
 * the client's own P&L/bank/review workflows use, so a dashboard number
 * always reconciles to what the professional finds inside that client.
 */
import {
  isUnresolvedTriage,
  isCurrencyMismatch,
  isReceiptDispositionConflict,
  isReceiptCurrencyConflict,
  computeCompleteness,
  type AnyDisposition,
} from "./pnl";

export type DashboardBankTxn = {
  id: string;
  clientId: string;
  date: string | null;
  description: string | null;
  amount: number;
  disposition: AnyDisposition;
  triage: string;
  categoryId: string | null;
  currency: string;
};

export type DashboardReceipt = {
  id: string;
  clientId: string;
  status: string;
  merchant: string | null;
  date: string | null;
  currency: string;
  categoryId: string | null;
  matchedBankDisposition: AnyDisposition | null;
};

export type DashboardClientMeta = {
  id: string;
  name: string;
  legalName: string | null;
  taxYear: number | null;
  accountingBasis: string | null;
  currency: string;
  updatedAt: string;
};

const RECEIPT_REVIEW_STATUSES = new Set(["uploaded", "extracting", "review"]);

export type ActionType =
  | "receipt_disposition_conflict"
  | "currency_conflict"
  | "missing_evidence"
  | "bank_exception"
  | "unclassified_transaction"
  | "uncategorized_activity"
  | "uncategorized_receipt_evidence"
  | "receipt_review"
  | "missing_document"
  | "document_review";

/** Lower number sorts first. Mirrors the milestone's required priority order. */
export const ACTION_PRIORITY: Record<ActionType, number> = {
  receipt_disposition_conflict: 1,
  currency_conflict: 1,
  missing_evidence: 2,
  missing_document: 2,
  bank_exception: 3,
  unclassified_transaction: 4,
  uncategorized_activity: 5,
  uncategorized_receipt_evidence: 5,
  receipt_review: 6,
  document_review: 6,
};

export type DashboardAction = {
  id: string;
  clientId: string;
  clientName: string;
  type: ActionType;
  priority: number;
  explanation: string;
  date: string | null;
  sourceEntityId: string;
  deepLink: string;
};

export type ClientReadiness = "ready" | "needs_review" | "missing_evidence" | "books_incomplete";

export type ClientDashboardRow = DashboardClientMeta & {
  readiness: ClientReadiness;
  income: number | null;
  receiptReviewCount: number;
  missingEvidenceCount: number;
  unresolvedBankExceptionCount: number;
  unclassifiedCount: number;
  uncategorizedCount: number;
  currencyConflictCount: number;
  filedReceiptCount: number;
  isComplete: boolean;
};

function deepLinkForTxn(clientId: string, txnId: string): string {
  return `/clients/${clientId}?tab=bank&focus=${txnId}`;
}

function deepLinkForReceipt(clientId: string, receiptId: string): string {
  return `/clients/${clientId}?tab=review&focus=${receiptId}`;
}

function deepLinkForChecklist(clientId: string, taxYear: number): string {
  return `/clients/${clientId}?tab=tax-readiness&taxYear=${taxYear}`;
}

function deepLinkForReceiptCategory(clientId: string, receiptId: string): string {
  return `/clients/${clientId}?tab=folders&focus=${receiptId}`;
}

function deepLinkForDocument(documentId: string): string {
  return `/documents/review?focus=${documentId}`;
}

export type DashboardChecklistItem = {
  id: string;
  clientId: string;
  taxYear: number;
  docType: string;
  customLabel: string | null;
  status: string;
};

export type DashboardDocument = {
  id: string;
  clientId: string;
  filename: string;
  documentType: string;
  status: string;
};

/**
 * Missing-document and document-review actions, built the same way as
 * every other action here: a pure function over already-fetched rows, fed
 * into the SAME canonical action queue/priority model as bank and receipt
 * actions rather than a second dashboard.
 */
export function buildDocumentWorkflowActions(
  clientId: string,
  clientName: string,
  checklistItems: DashboardChecklistItem[],
  documentsNeedingReview: DashboardDocument[],
): DashboardAction[] {
  const actions: DashboardAction[] = [];
  for (const item of checklistItems) {
    if (item.status !== "expected" && item.status !== "requested") continue;
    actions.push({
      id: `missing_document:${item.id}`,
      clientId,
      clientName,
      type: "missing_document",
      priority: ACTION_PRIORITY.missing_document,
      explanation: `Missing expected document: ${item.customLabel ?? item.docType.replace(/_/g, " ")} (tax year ${item.taxYear})`,
      date: null,
      sourceEntityId: item.id,
      deepLink: deepLinkForChecklist(clientId, item.taxYear),
    });
  }
  for (const doc of documentsNeedingReview) {
    if (doc.status !== "needs_review") continue;
    actions.push({
      id: `document_review:${doc.id}`,
      clientId,
      clientName,
      type: "document_review",
      priority: ACTION_PRIORITY.document_review,
      explanation: `Document awaiting review: ${doc.filename}`,
      date: null,
      sourceEntityId: doc.id,
      deepLink: deepLinkForDocument(doc.id),
    });
  }
  return actions;
}

/**
 * Builds every open action for one client's bank transactions and receipts,
 * plus the readiness summary counts that back the client status overview.
 * Pure function - no I/O - so it is directly unit testable and reused
 * identically by both the firm dashboard and (indirectly, via the same
 * predicates) the client workspace.
 */
export function buildClientDashboardRow(
  meta: DashboardClientMeta,
  bankTxns: DashboardBankTxn[],
  receipts: DashboardReceipt[],
  uncategorizedReceiptLineCount: number = 0,
): { row: ClientDashboardRow; actions: DashboardAction[] } {
  const actions: DashboardAction[] = [];
  const currency = meta.currency;

  let missingEvidenceCount = 0;
  let unresolvedBankExceptionCount = 0;
  let uncategorizedCount = 0;
  let bankCurrencyConflictCount = 0;

  for (const t of bankTxns) {
    if (t.triage === "unmatched") {
      missingEvidenceCount += 1;
      actions.push({
        id: `missing_evidence:${t.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "missing_evidence",
        priority: ACTION_PRIORITY.missing_evidence,
        explanation: `Missing receipt or evidence for ${t.description || "a bank transaction"}`,
        date: t.date,
        sourceEntityId: t.id,
        deepLink: deepLinkForTxn(meta.id, t.id),
      });
    } else if (isUnresolvedTriage(t.triage)) {
      unresolvedBankExceptionCount += 1;
      actions.push({
        id: `bank_exception:${t.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "bank_exception",
        priority: ACTION_PRIORITY.bank_exception,
        explanation: `Bank match needs a decision for ${t.description || "a bank transaction"}`,
        date: t.date,
        sourceEntityId: t.id,
        deepLink: deepLinkForTxn(meta.id, t.id),
      });
    }

    if (t.disposition === "unclassified") {
      actions.push({
        id: `unclassified:${t.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "unclassified_transaction",
        priority: ACTION_PRIORITY.unclassified_transaction,
        explanation: `Unclassified activity: ${t.description || "bank transaction"}`,
        date: t.date,
        sourceEntityId: t.id,
        deepLink: deepLinkForTxn(meta.id, t.id),
      });
    }

    const isBusiness = t.disposition === "business_expense" || t.disposition === "business_income";
    const mismatched = isCurrencyMismatch(t.currency, currency);
    if (isBusiness && mismatched) {
      bankCurrencyConflictCount += 1;
      actions.push({
        id: `currency_conflict_bank:${t.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "currency_conflict",
        priority: ACTION_PRIORITY.currency_conflict,
        explanation: `${t.currency} transaction does not match the client's ${currency} reporting currency`,
        date: t.date,
        sourceEntityId: t.id,
        deepLink: deepLinkForTxn(meta.id, t.id),
      });
    } else if (isBusiness && !mismatched && !t.categoryId) {
      uncategorizedCount += 1;
      actions.push({
        id: `uncategorized:${t.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "uncategorized_activity",
        priority: ACTION_PRIORITY.uncategorized_activity,
        explanation: `Business activity has no category: ${t.description || "bank transaction"}`,
        date: t.date,
        sourceEntityId: t.id,
        deepLink: deepLinkForTxn(meta.id, t.id),
      });
    }
  }

  let receiptCurrencyConflictCount = 0;
  let receiptDispositionConflictCount = 0;
  let receiptReviewCount = 0;
  let filedReceiptCount = 0;

  for (const r of receipts) {
    if (RECEIPT_REVIEW_STATUSES.has(r.status)) {
      receiptReviewCount += 1;
      actions.push({
        id: `receipt_review:${r.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "receipt_review",
        priority: ACTION_PRIORITY.receipt_review,
        explanation: `Receipt awaiting review${r.merchant ? `: ${r.merchant}` : ""}`,
        date: r.date,
        sourceEntityId: r.id,
        deepLink: deepLinkForReceipt(meta.id, r.id),
      });
      continue;
    }
    if (r.status !== "filed") continue;
    filedReceiptCount += 1;

    if (isReceiptDispositionConflict(r.matchedBankDisposition)) {
      receiptDispositionConflictCount += 1;
      actions.push({
        id: `receipt_disposition_conflict:${r.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "receipt_disposition_conflict",
        priority: ACTION_PRIORITY.receipt_disposition_conflict,
        explanation: `Filed receipt${r.merchant ? ` for ${r.merchant}` : ""} is matched to a bank transaction classified as ${r.matchedBankDisposition}`,
        date: r.date,
        sourceEntityId: r.id,
        deepLink: deepLinkForReceipt(meta.id, r.id),
      });
      continue;
    }
    if (isReceiptCurrencyConflict({ receiptCurrency: r.currency, clientCurrency: currency, matchedBankDisposition: r.matchedBankDisposition })) {
      receiptCurrencyConflictCount += 1;
      actions.push({
        id: `currency_conflict_receipt:${r.id}`,
        clientId: meta.id,
        clientName: meta.name,
        type: "currency_conflict",
        priority: ACTION_PRIORITY.currency_conflict,
        explanation: `${r.currency} receipt${r.merchant ? ` for ${r.merchant}` : ""} does not match the client's ${currency} reporting currency`,
        date: r.date,
        sourceEntityId: r.id,
        deepLink: deepLinkForReceipt(meta.id, r.id),
      });
    }
  }

  const currencyConflictCount = bankCurrencyConflictCount + receiptCurrencyConflictCount;

  const completeness = computeCompleteness({
    transactions: bankTxns.map((t) => ({ disposition: t.disposition, triage: t.triage, categoryId: t.categoryId, currency: t.currency })),
    clientCurrency: currency,
    uncategorizedReceiptLineCount,
    receiptCurrencyConflictCount,
  });

  let readiness: ClientReadiness;
  if (missingEvidenceCount > 0 || receiptDispositionConflictCount > 0) {
    readiness = "missing_evidence";
  } else if (!completeness.isComplete) {
    readiness = "books_incomplete";
  } else if (receiptReviewCount > 0) {
    readiness = "needs_review";
  } else {
    readiness = "ready";
  }

  return {
    row: {
      ...meta,
      readiness,
      income: null,
      receiptReviewCount,
      missingEvidenceCount,
      unresolvedBankExceptionCount,
      unclassifiedCount: completeness.unclassifiedCount,
      // Bank-side uncategorized business activity plus every canonical
      // uncategorized filed-receipt line - completeness.uncategorizedCount
      // is exactly that sum, so the displayed count can never read 0 while
      // uncategorized receipt evidence is the actual reason books are
      // incomplete.
      uncategorizedCount: completeness.uncategorizedCount,
      currencyConflictCount,
      filedReceiptCount,
      isComplete: completeness.isComplete,
    },
    actions,
  };
}

export type UncategorizedReceiptForAction = {
  receiptId: string;
  clientId: string;
  merchant: string | null;
  date: string | null;
};

/**
 * One action per affected receipt, not per uncategorized line - a
 * professional resolves the receipt's category once, which the canonical
 * predicate in getUncategorizedReceiptLineCount(s) treats as satisfying
 * every line on that receipt.
 */
export function buildUncategorizedReceiptActions(clientId: string, clientName: string, receipts: UncategorizedReceiptForAction[]): DashboardAction[] {
  return receipts.map((r) => ({
    id: `uncategorized_receipt:${r.receiptId}`,
    clientId,
    clientName,
    type: "uncategorized_receipt_evidence",
    priority: ACTION_PRIORITY.uncategorized_receipt_evidence,
    explanation: `Filed receipt evidence has no category${r.merchant ? `: ${r.merchant}` : ""}`,
    date: r.date,
    sourceEntityId: r.receiptId,
    deepLink: deepLinkForReceiptCategory(clientId, r.receiptId),
  }));
}

/** Deterministic order: highest-priority (lowest number) work first, oldest date first within a priority tier. */
export function sortActions(actions: DashboardAction[]): DashboardAction[] {
  return [...actions].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ad = a.date ?? "";
    const bd = b.date ?? "";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.id.localeCompare(b.id);
  });
}

export type DashboardFilter = "all" | "needs_attention" | "ready" | "missing_evidence" | "bank_issues" | "receipt_review";

export function matchesFilter(row: ClientDashboardRow, filter: DashboardFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return row.readiness === "ready";
    case "needs_attention":
      return row.readiness !== "ready";
    case "missing_evidence":
      return row.missingEvidenceCount > 0;
    case "bank_issues":
      return row.unresolvedBankExceptionCount > 0 || row.unclassifiedCount > 0 || row.currencyConflictCount > 0;
    case "receipt_review":
      return row.receiptReviewCount > 0;
    default:
      return true;
  }
}

export function matchesSearch(row: ClientDashboardRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || (row.legalName ?? "").toLowerCase().includes(q);
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  bank_csv_imported: "Bank statement imported",
  bank_disposition_changed: "Bank transaction classified",
  bank_duplicate_receipt_match_reopened: "Duplicate receipt match reopened",
  bank_match_confirmed: "Receipt match confirmed",
  bank_match_rejected: "Suggested receipt match rejected",
  bank_no_receipt_required: "No-receipt-required decision recorded",
  bank_receipt_linked_pending_review: "Missing receipt uploaded, pending review",
  bank_receipt_uploaded: "Receipt uploaded from bank exception",
  receipt_extracted: "Receipt evidence extracted",
  receipt_filed: "Receipt filed",
  receipt_review_edited: "Receipt review corrected",
  client_created: "Client added",
};

export type RecentActivityRow = {
  id: string;
  clientId: string;
  clientName: string;
  action: string;
  summary: string;
  actorUserId: string | null;
  createdAt: string;
};

/** Turns a raw audit_events row into one human sentence - never expose raw JSON to the professional. */
export function describeAuditEvent(input: {
  id: string;
  clientId: string;
  clientName: string;
  action: string;
  actorUserId: string | null;
  createdAt: string;
}): RecentActivityRow {
  return {
    id: input.id,
    clientId: input.clientId,
    clientName: input.clientName,
    action: input.action,
    summary: AUDIT_ACTION_LABELS[input.action] ?? input.action.replace(/_/g, " "),
    actorUserId: input.actorUserId,
    createdAt: input.createdAt,
  };
}

export type DashboardSummary = {
  clients: number;
  clientsReady: number;
  clientsNeedingAttention: number;
  totalOpenActions: number;
  receiptsAwaitingReview: number;
  missingEvidence: number;
  unresolvedBankExceptions: number;
  unclassifiedTransactions: number;
  uncategorizedActivity: number;
  currencyConflicts: number;
};

export function summarize(rows: ClientDashboardRow[], actions: DashboardAction[]): DashboardSummary {
  return {
    clients: rows.length,
    clientsReady: rows.filter((r) => r.readiness === "ready").length,
    clientsNeedingAttention: rows.filter((r) => r.readiness !== "ready").length,
    totalOpenActions: actions.length,
    receiptsAwaitingReview: rows.reduce((sum, r) => sum + r.receiptReviewCount, 0),
    missingEvidence: rows.reduce((sum, r) => sum + r.missingEvidenceCount, 0),
    unresolvedBankExceptions: rows.reduce((sum, r) => sum + r.unresolvedBankExceptionCount, 0),
    unclassifiedTransactions: rows.reduce((sum, r) => sum + r.unclassifiedCount, 0),
    uncategorizedActivity: rows.reduce((sum, r) => sum + r.uncategorizedCount, 0),
    currencyConflicts: rows.reduce((sum, r) => sum + r.currencyConflictCount, 0),
  };
}
