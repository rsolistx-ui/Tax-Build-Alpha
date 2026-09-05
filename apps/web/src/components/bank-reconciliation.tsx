import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, FileSpreadsheet, Link2, Upload, X } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
  suggestedReceipt: ReceiptLink | null;
  matchedReceipt: ReceiptLink | null;
  reviewedAt: string | null;
};

type ImportResult = {
  parsedRows: number;
  validRows: number;
  insertedCount: number;
  duplicateCount: number;
  rejectedRowCount: number;
  rowErrors: Array<{ sourceRow: number; message: string }>;
};

export function BankReconciliation({ clientId }: { clientId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ date: "", description: "" });
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTransactions() {
    const data = await api<{ transactions: BankTransaction[]; counts: Record<string, number> }>(
      `/api/clients/${clientId}/bank-transactions`,
    );
    setTransactions(data.transactions);
    setCounts(data.counts);
  }

  useEffect(() => {
    void loadTransactions().catch((e) => setError(e instanceof Error ? e.message : "Failed to load bank transactions"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function previewFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setImportResult(null);
    setError(null);
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
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mapping", JSON.stringify(mapping));
      const result = await api<ImportResult>(`/api/clients/${clientId}/bank-transactions/import`, {
        method: "POST",
        body: form,
      });
      setImportResult(result);
      await loadTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bank CSV import failed");
    } finally {
      setBusy(false);
    }
  }

  async function decide(transactionId: string, action: "confirm" | "reject") {
    setDecisionId(transactionId);
    setError(null);
    try {
      await api(`/api/clients/${clientId}/bank-transactions/${transactionId}/decision`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await loadTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save reconciliation decision");
    } finally {
      setDecisionId(null);
    }
  }

  const mappingReady = Boolean(mapping.date && mapping.description && (mapping.amount || mapping.debit || mapping.credit));
  const actionCount = useMemo(
    () => (counts.likely_match ?? 0) + (counts.needs_review ?? 0) + (counts.unmatched ?? 0),
    [counts],
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

          {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Reconciliation queue</CardTitle>
              <CardDescription>Deterministic suggestions are prepared from amount, date proximity, and merchant similarity. Nothing is matched until you confirm it.</CardDescription>
            </div>
            <Badge className="bg-stone-200 text-stone-700">{actionCount} action{actionCount === 1 ? "" : "s"}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No bank transactions imported yet.</p>
          ) : (
            <div className="space-y-2">
              {transactions.map((transaction) => (
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

                  {transaction.suggestedReceipt ? (
                    <div className="mt-4 rounded-md bg-[var(--color-muted)] p-3 text-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">Suggested evidence: {transaction.suggestedReceipt.merchant || transaction.suggestedReceipt.filename || "Receipt"}</p>
                          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                            {transaction.suggestedReceipt.date || "No date"} · {formatAmount(transaction.suggestedReceipt.total ?? 0, transaction.currency)}
                            {transaction.suggestedScore !== null ? ` · ${Math.round(transaction.suggestedScore * 100)}% match score` : ""}
                          </p>
                          {transaction.suggestedReason ? <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{transaction.suggestedReason}</p> : null}
                          <a href={apiUrl(transaction.suggestedReceipt.sourceUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline">
                            View receipt <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => void decide(transaction.id, "confirm")} disabled={decisionId === transaction.id}>
                            <Check className="h-3.5 w-3.5" /> Confirm
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => void decide(transaction.id, "reject")} disabled={decisionId === transaction.id}>
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : transaction.matchedReceipt ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-[var(--color-muted)] p-3 text-sm">
                      <div>
                        <p className="flex items-center gap-1.5 font-medium"><Link2 className="h-3.5 w-3.5" /> Matched to {transaction.matchedReceipt.merchant || transaction.matchedReceipt.filename || "receipt"}</p>
                        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Confirmed evidence relationship is persisted and auditable.</p>
                      </div>
                      <a href={apiUrl(transaction.matchedReceipt.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">View source <ExternalLink className="h-3 w-3" /></a>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">No receipt evidence matched within the deterministic tolerance. This transaction needs user action.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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

function TriageBadge({ triage }: { triage: string }) {
  const label = triage === "likely_match" ? "Likely match" : triage === "needs_review" ? "Needs review" : triage === "matched" ? "Matched" : "Unmatched";
  const className = triage === "matched"
    ? "bg-emerald-100 text-emerald-800"
    : triage === "likely_match"
      ? "bg-blue-100 text-blue-800"
      : triage === "needs_review"
        ? "bg-amber-100 text-amber-800"
        : "bg-stone-200 text-stone-700";
  return <Badge className={className}>{label}</Badge>;
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
