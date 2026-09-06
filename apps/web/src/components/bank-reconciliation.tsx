import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  FilePlus2,
  FileSpreadsheet,
  History,
  Link2,
  ReceiptText,
  Search,
  Upload,
  X,
} from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Mapping = {
  date: string;
  description: string;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  currency?: string | null;
};

type Preview = {
  filename: string;
  headers: string[];
  mapping: Mapping;
  ready: boolean;
  sampleRows: Record<string, string>[];
  rowCount: number;
};

type ReceiptLink = {
  id: string;
  status: string;
  date: string | null;
  merchant: string | null;
  total: number | null;
  filename: string | null;
  sourceUrl: string;
};

type BankTransaction = {
  id: string;
  date: string | null;
  description: string;
  amount: number;
  currency: string;
  triage: string;
  suggestedScore: number | null;
  suggestedReason: string | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
  suggestedReceipt: ReceiptLink | null;
  matchedReceipt: ReceiptLink | null;
  pendingReceipt: ReceiptLink | null;
  reviewedAt: string | null;
  disposition: string;
  suggestedDisposition: string | null;
  dispositionNote: string | null;
  dispositionReviewedAt: string | null;
  category: { id: string; name: string | null; slug: string | null } | null;
};

type BankSummary = {
  total: number;
  matched: number;
  needsReview: number;
  missingReceipt: number;
  receiptPending: number;
  noReceiptRequired: number;
  resolved: number;
  actionCount: number;
};

type ImportResult = {
  parsedRows: number;
  validRows: number;
  insertedCount: number;
  duplicateCount: number;
  rejectedRowCount: number;
  rowErrors: Array<{ sourceRow: number; message: string }>;
};

type AuditEvent = {
  id: string;
  action: string;
  receipt_id: string | null;
  created_at: string;
};

type Filter = "action" | "all" | "matched" | "needs_review" | "missing_receipt" | "receipt_pending" | "no_receipt_required";

const emptySummary: BankSummary = {
  total: 0,
  matched: 0,
  needsReview: 0,
  missingReceipt: 0,
  receiptPending: 0,
  noReceiptRequired: 0,
  resolved: 0,
  actionCount: 0,
};

export function BankReconciliation({
  clientId,
  onOpenReview,
  onReceiptAdded,
}: {
  clientId: string;
  onOpenReview?: () => void;
  onReceiptAdded?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ date: "", description: "" });
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [summary, setSummary] = useState<BankSummary>(emptySummary);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState<Filter>("action");
  const [busy, setBusy] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [receiptOptions, setReceiptOptions] = useState<ReceiptLink[]>([]);
  const [noReceiptId, setNoReceiptId] = useState<string | null>(null);
  const [noReceiptReason, setNoReceiptReason] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [dispositionBusyId, setDispositionBusyId] = useState<string | null>(null);

  async function loadTransactions() {
    const data = await api<{ transactions: BankTransaction[]; summary: BankSummary }>(
      `/api/clients/${clientId}/bank-transactions`,
    );
    setTransactions(data.transactions);
    setSummary(data.summary ?? emptySummary);
  }

  async function loadCategories() {
    try {
      const data = await api<{ categories: Array<{ id: string; name: string; slug: string }> }>(
        `/api/clients/${clientId}/categories`,
      );
      setCategories(data.categories);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadTransactions().catch((e) => setError(e instanceof Error ? e.message : "Failed to load bank transactions"));
    void loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function setDisposition(transactionId: string, disposition: string, categoryId: string | null, note: string | null) {
    setDispositionBusyId(transactionId);
    setError(null);
    try {
      await api(`/api/clients/${clientId}/bank-transactions/${transactionId}/disposition`, {
        method: "PATCH",
        body: JSON.stringify({ disposition, categoryId, note }),
      });
      await loadTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the accounting disposition");
    } finally {
      setDispositionBusyId(null);
    }
  }

  async function previewFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setImportResult(null);
    setError(null);
    setMessage(null);
    if (!nextFile) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", nextFile);
      const data = await api<Preview>(`/api/clients/${clientId}/bank-transactions/preview`, {
        method: "POST",
        body: form,
      });
      setPreview(data);
      setMapping(data.mapping);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function importCsv() {
    if (!file || !mappingReady) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mapping", JSON.stringify(mapping));
      const result = await api<ImportResult>(`/api/clients/${clientId}/bank-transactions/import`, {
        method: "POST",
        body: form,
      });
      setImportResult(result);
      setFilter("action");
      await loadTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bank CSV import failed");
    } finally {
      setBusy(false);
    }
  }

  async function decide(
    transactionId: string,
    action: "confirm" | "reject" | "link_receipt" | "no_receipt_required",
    extra: { receiptId?: string; reason?: string } = {},
  ) {
    setDecisionId(transactionId);
    setError(null);
    setMessage(null);
    try {
      await api(`/api/clients/${clientId}/bank-transactions/${transactionId}/decision`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      setLinkingId(null);
      setReceiptOptions([]);
      setNoReceiptId(null);
      setNoReceiptReason("");
      setHistoryId(null);
      setHistory([]);
      await loadTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save reconciliation decision");
    } finally {
      setDecisionId(null);
    }
  }

  async function uploadReceipt(transactionId: string, nextFile: File | null) {
    if (!nextFile) return;
    setUploadingId(transactionId);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", nextFile);
      form.append("bankTransactionId", transactionId);
      await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form });
      setMessage("Receipt extracted and attached to the bank exception. Review and file the evidence to finish the match.");
      await loadTransactions();
      onReceiptAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt upload failed");
    } finally {
      setUploadingId(null);
    }
  }

  async function loadReceiptOptions(transactionId: string) {
    if (linkingId === transactionId) {
      setLinkingId(null);
      setReceiptOptions([]);
      return;
    }
    setLinkingId(transactionId);
    setReceiptOptions([]);
    setError(null);
    try {
      const data = await api<{ receipts: ReceiptLink[] }>(
        `/api/clients/${clientId}/bank-transactions/${transactionId}/receipt-options`,
      );
      setReceiptOptions(data.receipts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load receipt options");
    }
  }

  async function loadHistory(transactionId: string) {
    if (historyId === transactionId) {
      setHistoryId(null);
      setHistory([]);
      return;
    }
    setHistoryId(transactionId);
    setHistory([]);
    setError(null);
    try {
      const data = await api<{ events: AuditEvent[] }>(
        `/api/clients/${clientId}/bank-transactions/${transactionId}/audit`,
      );
      setHistory(data.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load audit history");
    }
  }

  const mappingReady = Boolean(mapping.date && mapping.description && (mapping.amount || mapping.debit || mapping.credit));
  const visibleTransactions = useMemo(
    () => transactions.filter((transaction) => matchesFilter(transaction, filter)),
    [transactions, filter],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> Bank CSV import</CardTitle>
          <CardDescription>
            Folio maps the file, normalizes transactions, blocks duplicate reimports, and prepares receipt matches before you review them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-6 py-10 text-center hover:bg-[var(--color-muted)]/70">
            <Upload className="mb-3 h-5 w-5 text-[var(--color-muted-foreground)]" />
            <span className="text-sm font-medium">{busy ? "Reading bank file…" : file ? file.name : "Choose a bank CSV"}</span>
            <span className="mt-1 text-xs text-[var(--color-muted-foreground)]">CSV only · up to 5 MB and 5,000 rows</span>
            <input type="file" className="hidden" accept=".csv,text/csv" disabled={busy} onChange={(e) => void previewFile(e.target.files?.[0] ?? null)} />
          </label>

          {preview ? (
            <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Column mapping</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{preview.rowCount} transaction row(s) detected. Confirm the bank's columns before import.</p>
                </div>
                <Badge className={mappingReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                  {mappingReady ? "Ready" : "Mapping needed"}
                </Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <MapSelect label="Date" required value={mapping.date} headers={preview.headers} onChange={(value) => setMapping((current) => ({ ...current, date: value }))} />
                <MapSelect label="Description" required value={mapping.description} headers={preview.headers} onChange={(value) => setMapping((current) => ({ ...current, description: value }))} />
                <MapSelect label="Signed amount" value={mapping.amount ?? ""} headers={preview.headers} onChange={(value) => setMapping((current) => ({ ...current, amount: value || null }))} />
                <MapSelect label="Debit / withdrawal" value={mapping.debit ?? ""} headers={preview.headers} onChange={(value) => setMapping((current) => ({ ...current, debit: value || null }))} />
                <MapSelect label="Credit / deposit" value={mapping.credit ?? ""} headers={preview.headers} onChange={(value) => setMapping((current) => ({ ...current, credit: value || null }))} />
                <MapSelect label="Currency" value={mapping.currency ?? ""} headers={preview.headers} onChange={(value) => setMapping((current) => ({ ...current, currency: value || null }))} />
              </div>

              <p className="text-xs text-[var(--color-muted-foreground)]">
                Use Signed amount when the bank provides one amount column. If it provides separate debit and credit columns, leave Signed amount blank and map those instead.
              </p>

              <Button onClick={() => void importCsv()} disabled={busy || !mappingReady}>
                {busy ? "Importing…" : "Import and prepare reconciliation"}
              </Button>
            </div>
          ) : null}

          {importResult ? (
            <div className="rounded-lg bg-[var(--color-muted)] p-4 text-sm">
              <p className="font-medium">Import prepared</p>
              <p className="mt-1 text-[var(--color-muted-foreground)]">
                {importResult.insertedCount} new · {importResult.duplicateCount} duplicate · {importResult.rejectedRowCount} rejected
              </p>
              {importResult.rowErrors.length ? (
                <p className="mt-2 text-xs text-[var(--color-destructive)]">
                  Rejected rows: {importResult.rowErrors.slice(0, 5).map((item) => `${item.sourceRow} (${item.message})`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Bank exceptions</CardTitle>
              <CardDescription>
                Folio prepares the evidence and exceptions. A person confirms the match, supplies missing evidence, or documents why a receipt is not required.
              </CardDescription>
            </div>
            <Badge className="bg-stone-200 text-stone-700">{summary.actionCount} action{summary.actionCount === 1 ? "" : "s"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricButton label="Needs action" value={summary.actionCount} active={filter === "action"} onClick={() => setFilter("action")} />
            <MetricButton label="Matched" value={summary.matched} active={filter === "matched"} onClick={() => setFilter("matched")} />
            <MetricButton label="Needs review" value={summary.needsReview} active={filter === "needs_review"} onClick={() => setFilter("needs_review")} />
            <MetricButton label="Missing receipt" value={summary.missingReceipt} active={filter === "missing_receipt"} onClick={() => setFilter("missing_receipt")} />
            <MetricButton label="Receipt pending" value={summary.receiptPending} active={filter === "receipt_pending"} onClick={() => setFilter("receipt_pending")} />
            <MetricButton label="No receipt required" value={summary.noReceiptRequired} active={filter === "no_receipt_required"} onClick={() => setFilter("no_receipt_required")} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Showing {visibleTransactions.length} of {summary.total} transaction{summary.total === 1 ? "" : "s"}
            </p>
            <Button size="sm" variant="secondary" onClick={() => setFilter(filter === "all" ? "action" : "all")}>
              <Search className="h-3.5 w-3.5" /> {filter === "all" ? "Needs action" : "Show all"}
            </Button>
          </div>

          {message ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
          {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

          {transactions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No bank transactions imported yet.</p>
          ) : visibleTransactions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No transactions are in this queue.</p>
          ) : (
            <div className="space-y-2">
              {visibleTransactions.map((transaction) => (
                <div key={transaction.id} className="rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{transaction.description}</p>
                        <TriageBadge triage={transaction.triage} />
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{transaction.date || "No date"} · {transaction.currency}</p>
                    </div>
                    <p className="text-base font-semibold">{formatAmount(transaction.amount, transaction.currency)}</p>
                  </div>

                  {transaction.matchedReceipt ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-emerald-50 p-3 text-sm">
                      <div>
                        <p className="flex items-center gap-1.5 font-medium text-emerald-900"><Link2 className="h-3.5 w-3.5" /> Matched to {receiptName(transaction.matchedReceipt)}</p>
                        <p className="mt-1 text-xs text-emerald-800">The evidence relationship is resolved and auditable.</p>
                      </div>
                      <a href={apiUrl(transaction.matchedReceipt.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">View source <ExternalLink className="h-3 w-3" /></a>
                    </div>
                  ) : transaction.triage === "no_receipt_required" ? (
                    <div className="mt-4 rounded-md bg-[var(--color-muted)] p-3 text-sm">
                      <p className="font-medium">Resolved without receipt evidence</p>
                      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{transaction.resolutionReason || "No reason recorded"}</p>
                    </div>
                  ) : transaction.pendingReceipt ? (
                    <div className="mt-4 rounded-md bg-blue-50 p-3 text-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="flex items-center gap-1.5 font-medium text-blue-900"><Clock3 className="h-3.5 w-3.5" /> Receipt waiting for professional review</p>
                          <p className="mt-1 text-xs text-blue-800">{receiptName(transaction.pendingReceipt)} · filing this deliberately linked receipt will complete the bank match.</p>
                          <a href={apiUrl(transaction.pendingReceipt.sourceUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline">View source <ExternalLink className="h-3 w-3" /></a>
                        </div>
                        {onOpenReview ? <Button size="sm" variant="secondary" onClick={onOpenReview}>Review receipt</Button> : null}
                      </div>
                    </div>
                  ) : transaction.suggestedReceipt ? (
                    <div className="mt-4 rounded-md bg-[var(--color-muted)] p-3 text-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">Suggested evidence: {receiptName(transaction.suggestedReceipt)}</p>
                          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                            {transaction.suggestedReceipt.date || "No date"} · {formatAmount(transaction.suggestedReceipt.total ?? 0, transaction.currency)}
                            {transaction.suggestedScore !== null ? ` · ${Math.round(transaction.suggestedScore * 100)}% match score` : ""}
                          </p>
                          {transaction.suggestedReason ? <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{transaction.suggestedReason}</p> : null}
                          <a href={apiUrl(transaction.suggestedReceipt.sourceUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline">
                            View receipt <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => void decide(transaction.id, "confirm")} disabled={decisionId === transaction.id}>
                            <Check className="h-3.5 w-3.5" /> Confirm
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => void decide(transaction.id, "reject")} disabled={decisionId === transaction.id}>
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm">
                      <p className="font-medium text-amber-900">Receipt evidence is missing</p>
                      <p className="mt-1 text-xs text-amber-800">Resolve this transaction here instead of searching outside the client workspace.</p>
                    </div>
                  )}

                  {!isResolved(transaction) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {transaction.triage !== "receipt_pending" ? (
                        <label className={cn(
                          "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm font-medium hover:bg-[var(--color-muted)]",
                          uploadingId === transaction.id && "pointer-events-none opacity-60",
                        )}>
                          <FilePlus2 className="h-3.5 w-3.5" /> {uploadingId === transaction.id ? "Extracting…" : "Upload receipt"}
                          <input
                            type="file"
                            className="hidden"
                            accept="image/*,application/pdf"
                            disabled={uploadingId === transaction.id}
                            onChange={(e) => void uploadReceipt(transaction.id, e.target.files?.[0] ?? null)}
                          />
                        </label>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={() => void loadReceiptOptions(transaction.id)}>
                        <ReceiptText className="h-3.5 w-3.5" /> {linkingId === transaction.id ? "Close receipts" : "Link existing receipt"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => {
                        setNoReceiptId(noReceiptId === transaction.id ? null : transaction.id);
                        setNoReceiptReason("");
                      }}>
                        No receipt required
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void loadHistory(transaction.id)}>
                        <History className="h-3.5 w-3.5" /> History
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Button size="sm" variant="ghost" onClick={() => void loadHistory(transaction.id)}>
                        <History className="h-3.5 w-3.5" /> History
                      </Button>
                    </div>
                  )}

                  {noReceiptId === transaction.id ? (
                    <div className="mt-3 flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3 sm:flex-row sm:items-end">
                      <label className="flex-1 space-y-1 text-xs font-medium">
                        <span>Why is receipt evidence not required?</span>
                        <input
                          value={noReceiptReason}
                          onChange={(e) => setNoReceiptReason(e.target.value)}
                          placeholder="Record the professional's reason"
                          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm font-normal"
                        />
                      </label>
                      <Button
                        size="sm"
                        disabled={noReceiptReason.trim().length < 3 || decisionId === transaction.id}
                        onClick={() => void decide(transaction.id, "no_receipt_required", { reason: noReceiptReason.trim() })}
                      >
                        Save resolution
                      </Button>
                    </div>
                  ) : null}

                  {linkingId === transaction.id ? (
                    <div className="mt-3 space-y-2 rounded-md border border-[var(--color-border)] p-3">
                      <div>
                        <p className="text-sm font-medium">Existing receipt evidence</p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">Closest receipts are shown first. Filed receipts resolve immediately. Receipts in review finish the match when filed.</p>
                      </div>
                      {receiptOptions.length === 0 ? (
                        <p className="text-xs text-[var(--color-muted-foreground)]">No review or filed receipts available.</p>
                      ) : receiptOptions.map((receipt) => (
                        <div key={receipt.id} className="flex flex-col gap-2 rounded-md bg-[var(--color-muted)] p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium">{receiptName(receipt)}</p>
                              <Badge className={receipt.status === "filed" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}>{receipt.status === "filed" ? "Filed" : "Review"}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{receipt.date || "No date"}{receipt.total !== null ? ` · ${formatAmount(receipt.total, transaction.currency)}` : ""}</p>
                          </div>
                          <div className="flex gap-2">
                            <a href={apiUrl(receipt.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 text-xs font-medium hover:underline">View <ExternalLink className="h-3 w-3" /></a>
                            <Button size="sm" onClick={() => void decide(transaction.id, "link_receipt", { receiptId: receipt.id })} disabled={decisionId === transaction.id}>Link</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {historyId === transaction.id ? (
                    <div className="mt-3 rounded-md border border-[var(--color-border)] p-3">
                      <p className="text-sm font-medium">Audit history</p>
                      {history.length === 0 ? (
                        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">No reconciliation decisions recorded yet.</p>
                      ) : (
                        <div className="mt-2 space-y-1.5">
                          {history.map((event) => (
                            <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span>{auditLabel(event.action)}</span>
                              <span className="text-[var(--color-muted-foreground)]">{formatTimestamp(event.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                  <DispositionPanel
                    transaction={transaction}
                    categories={categories}
                    busy={dispositionBusyId === transaction.id}
                    onSave={(disposition, categoryId, note) => void setDisposition(transaction.id, disposition, categoryId, note)}
                  />

                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const DISPOSITION_LABELS: Record<string, string> = {
  business_expense: "Business expense",
  business_income: "Business income",
  personal: "Personal / non-business",
  transfer: "Transfer",
  owner_contribution: "Owner contribution",
  owner_draw: "Owner draw",
  loan: "Loan",
  other_excluded: "Other excluded",
  unclassified: "Unclassified",
};

function DispositionPanel({
  transaction,
  categories,
  busy,
  onSave,
}: {
  transaction: BankTransaction;
  categories: Array<{ id: string; name: string; slug: string }>;
  busy: boolean;
  onSave: (disposition: string, categoryId: string | null, note: string | null) => void;
}) {
  const [disposition, setDisposition] = useState(transaction.disposition);
  const [categoryId, setCategoryId] = useState(transaction.category?.id ?? "");
  const [note, setNote] = useState(transaction.dispositionNote ?? "");

  useEffect(() => {
    setDisposition(transaction.disposition);
    setCategoryId(transaction.category?.id ?? "");
    setNote(transaction.dispositionNote ?? "");
  }, [transaction.id, transaction.disposition, transaction.category?.id, transaction.dispositionNote]);

  const dirty = disposition !== transaction.disposition
    || categoryId !== (transaction.category?.id ?? "")
    || note !== (transaction.dispositionNote ?? "");

  return (
    <div className="mt-3 rounded-md border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Bookkeeping disposition</p>
        <Badge className={transaction.disposition === "unclassified" ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-700"}>
          {DISPOSITION_LABELS[transaction.disposition] ?? transaction.disposition}
        </Badge>
      </div>
      {transaction.disposition === "unclassified" && transaction.suggestedDisposition ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          Prepared, not decided: this looks like {DISPOSITION_LABELS[transaction.suggestedDisposition] ?? transaction.suggestedDisposition} based on the amount direction. A professional must confirm it.
        </p>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium">
          <span>Disposition</span>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal"
          >
            {Object.entries(DISPOSITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span>Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal"
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason or context for this classification"
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal"
          />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {transaction.dispositionReviewedAt
            ? `Last reviewed ${formatTimestamp(transaction.dispositionReviewedAt)}`
            : "Never explicitly reviewed"}
        </p>
        <Button
          size="sm"
          disabled={!dirty || busy}
          onClick={() => onSave(disposition, categoryId || null, note.trim() || null)}
        >
          {busy ? "Saving…" : "Save disposition"}
        </Button>
      </div>
    </div>
  );
}

function MapSelect({ label, required = false, value, headers, onChange }: {
  label: string;
  required?: boolean;
  value: string;
  headers: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs font-medium">
      <span>{label}{required ? " *" : ""}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal"
      >
        <option value="">Not mapped</option>
        {headers.map((header) => <option key={header} value={header}>{header}</option>)}
      </select>
    </label>
  );
}

function MetricButton({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border border-[var(--color-border)] p-3 text-left hover:bg-[var(--color-muted)]/60",
        active && "bg-[var(--color-muted)] ring-1 ring-[var(--color-foreground)]/15",
      )}
    >
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </button>
  );
}

function TriageBadge({ triage }: { triage: string }) {
  const label = triage === "likely_match"
    ? "Likely match"
    : triage === "needs_review"
      ? "Needs review"
      : triage === "matched"
        ? "Matched"
        : triage === "receipt_pending"
          ? "Receipt pending"
          : triage === "no_receipt_required"
            ? "Resolved"
            : "Missing receipt";
  const className = triage === "matched" || triage === "no_receipt_required"
    ? "bg-emerald-100 text-emerald-800"
    : triage === "likely_match"
      ? "bg-blue-100 text-blue-800"
      : triage === "needs_review" || triage === "receipt_pending"
        ? "bg-amber-100 text-amber-800"
        : "bg-stone-200 text-stone-700";
  return <Badge className={className}>{label}</Badge>;
}

function matchesFilter(transaction: BankTransaction, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "action") return !isResolved(transaction);
  if (filter === "matched") return transaction.triage === "matched";
  if (filter === "needs_review") return transaction.triage === "likely_match" || transaction.triage === "needs_review";
  if (filter === "missing_receipt") return transaction.triage === "unmatched";
  if (filter === "receipt_pending") return transaction.triage === "receipt_pending";
  return transaction.triage === "no_receipt_required";
}

function isResolved(transaction: BankTransaction): boolean {
  return transaction.triage === "matched" || transaction.triage === "no_receipt_required";
}

function receiptName(receipt: ReceiptLink): string {
  return receipt.merchant || receipt.filename || "Receipt";
}

function auditLabel(action: string): string {
  if (action === "bank_match_confirmed") return "Receipt match confirmed";
  if (action === "bank_match_rejected") return "Suggested or linked receipt rejected";
  if (action === "bank_receipt_uploaded") return "Missing receipt uploaded";
  if (action === "bank_receipt_linked_pending_review") return "Existing receipt linked pending review";
  if (action === "bank_no_receipt_required") return "Resolved with no receipt required";
  if (action === "bank_disposition_changed") return "Accounting disposition changed";
  return action.replace(/_/g, " ");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
