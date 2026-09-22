import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileArchive, FileSpreadsheet } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { presetRange, REPORTING_PERIOD_OPTIONS, type ReportingPeriodPreset } from "@/lib/reporting-period";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/formatters";

type ExportPreview = {
  client?: string;
  periodStart: string | null;
  periodEnd: string | null;
  currency?: string;
  accountingBasis?: string;
  income?: number;
  expenses?: number;
  net?: number;
  totalBankTransactions?: number;
  totalFiledReceipts?: number;
  excludedTransactions?: number;
  openItemsCount?: number;
  receiptsAwaitingReviewCount?: number;
  outstandingClientRequestCount?: number;
  isDraft?: boolean;
  accrualSupported?: boolean;
  warning?: string;
  signoff?: { actorUserId: string; signedAt: string; note?: string | null } | null;
  completeness?: {
    unclassifiedCount: number;
    unresolvedTriageCount: number;
    uncategorizedCount: number;
    currencyConflictCount: number;
    isComplete: boolean;
  };
};

type ImportBatch = {
  importBatchId: string | null;
  currency: string;
  transactionCount: number;
  earliestDate: string | null;
  latestDate: string | null;
};

type CloseExceptions = {
  openItems: Array<{ kind: string; description: string; detail: string }>;
  receiptsAwaitingReview: Array<{ filename: string; validationStatus: string; notes: string | null }>;
  outstandingClientRequests: Array<{ title: string; status: string; dueAt: string | null }>;
};

function Bullet({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] py-1.5 text-sm last:border-b-0">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function ExportCenter({ clientId, taxYear, onNavigate }: { clientId: string; taxYear: number | null; onNavigate?: (destination: "review" | "bank" | "requests") => void }) {
  const [preset, setPreset] = useState<ReportingPeriodPreset>("current_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [selectedBatchKey, setSelectedBatchKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signoffNote, setSignoffNote] = useState("");
  const [signingOff, setSigningOff] = useState(false);
  const [exceptions, setExceptions] = useState<CloseExceptions | null>(null);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);

  const range = useMemo(() => {
    if (preset === "custom") return { startDate: customStart, endDate: customEnd };
    return presetRange(preset, taxYear);
  }, [preset, customStart, customEnd, taxYear]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (range.startDate) p.set("startDate", range.startDate);
    if (range.endDate) p.set("endDate", range.endDate);
    return p;
  }, [range.startDate, range.endDate]);

  useEffect(() => {
    if (!range.startDate && !range.endDate && preset === "custom") return;
    setError(null);
    setLoading(true);
    Promise.all([
      api<ExportPreview>(`/api/clients/${clientId}/export/preview?${params.toString()}`),
      api<{ batches: ImportBatch[] }>(`/api/clients/${clientId}/export/import-batches?${params.toString()}`),
    ])
      .then(([previewData, batchData]) => {
        setPreview(previewData);
        setBatches(batchData.batches);
        setSelectedBatchKey(null);
        setExceptions(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load export preview"))
      .finally(() => setLoading(false));
  }, [clientId, params, preset, range.startDate, range.endDate]);

  const selectedBatch = batches.find((b) => `${b.importBatchId ?? "__none__"}::${b.currency}` === selectedBatchKey) ?? null;

  const workbookUrl = apiUrl(`/api/clients/${clientId}/export/workbook?${params.toString()}`);
  const cleanExitManifestUrl = apiUrl(`/api/clients/${clientId}/export/clean-exit-manifest`);
  const bankCsvUrl = selectedBatch
    ? apiUrl(
        `/api/clients/${clientId}/export/bank-transactions-csv?${params.toString()}&importBatchId=${encodeURIComponent(
          selectedBatch.importBatchId ?? "__none__",
        )}&currency=${encodeURIComponent(selectedBatch.currency)}`,
      )
    : null;

  async function recordSignoff() {
    setSigningOff(true);
    setError(null);
    try {
      await api(`/api/clients/${clientId}/export/signoff`, {
        method: "POST",
        body: JSON.stringify({ startDate: range.startDate, endDate: range.endDate, note: signoffNote }),
      });
      setSignoffNote("");
      const refreshed = await api<ExportPreview>(`/api/clients/${clientId}/export/preview?${params.toString()}`);
      setPreview(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record close sign-off");
    } finally {
      setSigningOff(false);
    }
  }

  async function showExceptions() {
    setExceptionsOpen(true);
    if (exceptions) return;
    try {
      const result = await api<CloseExceptions>(`/api/clients/${clientId}/export/exceptions?${params.toString()}`);
      setExceptions(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load close exceptions");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {REPORTING_PERIOD_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreset(value)}
              className={cn(
                "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm",
                preset === value && "bg-[var(--color-muted)] font-medium",
              )}
            >
              {label}
            </button>
          ))}
          {preset === "custom" ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
              />
              <span className="text-sm text-[var(--color-muted-foreground)]">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
              />
            </div>
          ) : (
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {range.startDate} to {range.endDate}
            </span>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {loading ? <p className="text-sm text-[var(--color-muted-foreground)]">Loading export preview…</p> : null}

      {preview && preview.accrualSupported === false ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{preview.warning}</p>
        </div>
      ) : null}

      {preview && preview.accrualSupported !== false ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4" /> Close & preparer packet
              </CardTitle>
              <CardDescription>
                A source-backed cash-basis workpaper packet. It is never an e-filed return and stays draft until every exception is resolved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "mb-3 flex items-center gap-2 rounded-md border p-2 text-sm font-medium",
                  preview.isDraft
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-emerald-300 bg-emerald-50 text-emerald-900",
                )}
              >
                {preview.isDraft ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                {preview.isDraft ? "DRAFT - items require professional review" : "Complete for the selected period"}
              </div>
              <Bullet label="Client" value={preview.client ?? "—"} />
              <Bullet label="Reporting period" value={`${preview.periodStart ?? "unbounded"} to ${preview.periodEnd ?? "unbounded"}`} />
              <Bullet label="Accounting basis" value={preview.accountingBasis ?? "—"} />
              <Bullet label="Currency" value={preview.currency ?? "—"} />
              <Bullet label="Income" value={`$${Number(preview.income ?? 0).toFixed(2)}`} />
              <Bullet label="Expenses" value={`$${Number(preview.expenses ?? 0).toFixed(2)}`} />
              <Bullet label="Net" value={`$${Number(preview.net ?? 0).toFixed(2)}`} />
              <Bullet label="Bank transactions" value={preview.totalBankTransactions ?? 0} />
              <Bullet label="Filed receipts" value={preview.totalFiledReceipts ?? 0} />
              <Bullet label="Excluded / nonbusiness transactions" value={preview.excludedTransactions ?? 0} />
              <Bullet label="Unresolved items" value={preview.completeness?.unresolvedTriageCount ?? 0} />
              <Bullet label="Uncategorized items" value={preview.completeness?.uncategorizedCount ?? 0} />
              <Bullet label="Currency conflicts" value={preview.completeness?.currencyConflictCount ?? 0} />
              <Bullet label="Open items" value={preview.openItemsCount ?? 0} />
              <Bullet label="Receipts awaiting professional review" value={preview.receiptsAwaitingReviewCount ?? 0} />
              <Bullet label="Outstanding client requests" value={preview.outstandingClientRequestCount ?? 0} />
              {preview.isDraft ? <div className="mt-4 border-t border-[var(--color-border)] pt-4"><Button type="button" variant="secondary" onClick={() => void showExceptions()}><AlertTriangle className="h-4 w-4" /> Open close exceptions</Button></div> : null}
              {exceptionsOpen ? <section className="mt-4 border-t border-[var(--color-border)] pt-4" aria-live="polite"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Close exceptions</h3><Button type="button" size="sm" variant="ghost" onClick={() => setExceptionsOpen(false)}>Hide</Button></div>{!exceptions ? <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">Loading exceptions…</p> : <div className="mt-3 space-y-3 text-sm"><ExceptionGroup title="Bank and evidence decisions" items={exceptions.openItems.map((item) => `${item.description}: ${item.detail}`)} action={onNavigate ? <Button type="button" variant="outline" size="sm" onClick={() => onNavigate("bank")}>Resolve bank items</Button> : undefined} /><ExceptionGroup title="Receipts awaiting review" items={exceptions.receiptsAwaitingReview.map((item) => `${item.filename}: ${item.validationStatus}${item.notes ? ` — ${item.notes}` : ""}`)} action={onNavigate ? <Button type="button" variant="outline" size="sm" onClick={() => onNavigate("review")}>Open receipt review</Button> : undefined} /><ExceptionGroup title="Outstanding client requests" items={exceptions.outstandingClientRequests.map((item) => `${item.title}: ${item.status}${item.dueAt ? ` · due ${item.dueAt}` : ""}`)} action={onNavigate ? <Button type="button" variant="outline" size="sm" onClick={() => onNavigate("requests")}>Open client requests</Button> : undefined} /></div>}</section> : null}
              {!preview.isDraft ? (
                <div className="mt-5 border-t border-[var(--color-border)] pt-4">
                  {preview.signoff ? (
                    <div className="flex items-start gap-2 rounded-md bg-[var(--color-success-bg)] p-3 text-sm text-[var(--color-success)]">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <div><p className="font-semibold">Practitioner close sign-off recorded</p><p className="mt-0.5 text-xs">Recorded {formatDateTime(preview.signoff.signedAt)}.</p>{preview.signoff.note ? <p className="mt-1 text-xs">{preview.signoff.note}</p> : null}</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold" htmlFor="close-signoff-note">Practitioner sign-off</label>
                      <p className="text-xs text-[var(--color-muted-foreground)]">This records that you reviewed the selected period. It does not e-file a return or replace your professional judgment.</p>
                      <textarea id="close-signoff-note" value={signoffNote} onChange={(event) => setSignoffNote(event.target.value)} maxLength={1000} rows={2} placeholder="Optional review note" className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm" />
                      <Button type="button" onClick={() => void recordSignoff()} disabled={signingOff}>{signingOff ? "Recording sign-off…" : "Record practitioner sign-off"}</Button>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Packet downloads</CardTitle>
              <CardDescription>
                The Excel close packet contains the P&L, evidence, ledger, review queue, client-request exceptions, and reconciliation detail. The transactions CSV
                transfers only transaction dates, descriptions, and amounts — Folio categories and review
                decisions are provided separately in the workbook&apos;s Transaction Review worksheet.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <a href={workbookUrl} target="_blank" rel="noreferrer">
                <Button className="gap-2">
                  <Download className="h-4 w-4" /> Download Close & Preparer Packet{preview.isDraft ? " (DRAFT)" : ""}
                </Button>
              </a>

              <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
                <p className="text-sm font-medium">Bank transactions CSV</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  This file transfers transaction statement data only. Folio categories and review decisions are
                  provided separately in the workbook&apos;s Transaction Review worksheet. Select a single
                  source/import batch and currency — Folio never merges unrelated bank accounts or currencies
                  into one statement file.
                </p>
                {batches.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">No bank transactions in this period.</p>
                ) : (
                  <select
                    value={selectedBatchKey ?? ""}
                    onChange={(e) => setSelectedBatchKey(e.target.value || null)}
                    className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                  >
                    <option value="">Select a source/import batch and currency…</option>
                    {batches.map((b) => {
                      const key = `${b.importBatchId ?? "__none__"}::${b.currency}`;
                      return (
                        <option key={key} value={key}>
                          {b.importBatchId ?? "(manual entry)"} · {b.currency} · {b.transactionCount} txns · {b.earliestDate}–{b.latestDate}
                        </option>
                      );
                    })}
                  </select>
                )}
                {bankCsvUrl ? (
                  <a href={bankCsvUrl} target="_blank" rel="noreferrer">
                    <Button variant="secondary" className="gap-2">
                      <Download className="h-4 w-4" /> Download Bank Transactions CSV
                    </Button>
                  </a>
                ) : null}
              </div>

              <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
                <p className="text-sm font-medium">Clean-exit inventory</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  A vendor-independent record index with source hashes, document states, signature history, and authenticated original-file paths. It complements—not replaces—the close packet and original evidence downloads.
                </p>
                <a href={cleanExitManifestUrl} target="_blank" rel="noreferrer">
                  <Button variant="secondary" className="gap-2">
                    <FileArchive className="h-4 w-4" /> Download clean-exit inventory
                  </Button>
                </a>
              </div>

              <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
                <p className="text-sm font-medium">Tax preparation handoff</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Phyllis&apos;s tax-preparation system is MyTAXPrepOffice. Download the close packet first, then open its secure workspace to prepare and e-file the return. Truepost never shares her login, embeds the vendor&apos;s site, or claims a direct data import without an approved vendor API.
                </p>
                <a href="https://app.mytaxprepoffice.com/#/login" target="_blank" rel="noreferrer noopener">
                  <Button variant="outline" className="gap-2">
                    <ExternalLink className="h-4 w-4" /> Open MyTAXPrepOffice
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ExceptionGroup({ title, items, action }: { title: string; items: string[]; action?: ReactNode }) {
  return <div>{items.length ? <><p className="text-xs font-semibold text-[var(--color-muted-foreground)]">{title}</p><ul className="mt-1 space-y-1">{items.map((item, index) => <li key={`${title}-${index}`} className="border-b border-[var(--color-border)] pb-1.5 last:border-0">{item}</li>)}</ul>{action ? <div className="mt-2">{action}</div> : null}</> : null}</div>;
}
