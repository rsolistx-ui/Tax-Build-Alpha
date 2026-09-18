import { useState, useRef, useEffect } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  X,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type SourceType =
  | "transactions"
  | "customers"
  | "vendors"
  | "invoices"
  | "bills"
  | "chart_of_accounts";

interface ClientOption {
  id: string;
  name: string;
}

interface ImportJobResult {
  jobId: string;
  status: "completed" | "failed" | "partial";
  totalRows: number;
  processedRows: number;
  failedRows: number;
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  errors: Array<{ row: number; message: string; data?: any }>;
}

interface AccountingImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultClientId?: string;
  onSuccess?: () => void;
}

export function AccountingImportModal({
  isOpen,
  onClose,
  defaultClientId,
  onSuccess,
}: AccountingImportModalProps) {
  const [sourceType, setSourceType] = useState<SourceType>("transactions");
  const [selectedClientId, setSelectedClientId] = useState<string>(defaultClientId ?? "");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"select" | "processing" | "result">("select");
  const [result, setResult] = useState<ImportJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackDone, setRollbackDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      void loadClients();
      setStage("select");
      setResult(null);
      setError(null);
      setRollbackDone(false);
      if (defaultClientId) setSelectedClientId(defaultClientId);
    }
  }, [isOpen, defaultClientId]);

  async function loadClients() {
    try {
      const data = await api<{ clients: ClientOption[] }>("/api/clients");
      setClients(data.clients || []);
    } catch {
      // Best effort load
    }
  }

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      if (dropped.name.endsWith(".csv")) {
        setFile(dropped);
        setError(null);
      } else {
        setError("Please select a standard CSV file.");
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please select an exported CSV file to import.");
      return;
    }

    setLoading(true);
    setStage("processing");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append(
        "options",
        JSON.stringify({
          sourceType,
          clientId: selectedClientId || undefined,
          options: {
            skipDuplicates: true,
            dryRun: false,
            createMissingClients: true,
            defaultClientId: selectedClientId || undefined,
          },
        })
      );

      // 1. Create import job via legacy migration endpoint
      const jobRes = await api<{ jobId: string }>("/api/wave-import/jobs", {
        method: "POST",
        body: formData,
      });

      // 2. Process import
      const processRes = await api<{ result: ImportJobResult }>(
        `/api/wave-import/jobs/${jobRes.jobId}/process`,
        { method: "POST" }
      );

      setResult(processRes.result);
      setStage("result");
      onSuccess?.();
    } catch (err: any) {
      setError(err?.message || "Failed to import file. Please verify CSV formatting.");
      setStage("select");
    } finally {
      setLoading(false);
    }
  }

  async function handleRollback() {
    if (!result?.jobId) return;
    setRollingBack(true);
    try {
      await api(`/api/wave-import/jobs/${result.jobId}/rollback`, { method: "POST" });
      setRollbackDone(true);
      onSuccess?.();
    } catch (err: any) {
      setError(err?.message || "Failed to rollback import.");
    } finally {
      setRollingBack(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="relative w-full max-w-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <UploadCloud className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">1-Click Accounting CSV Migration</CardTitle>
              <CardDescription className="text-xs">
                Import historical books and transactions into Folio's verified accounting engine.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {stage === "select" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="import-source-type" className="text-xs font-medium">
                  What are you importing?
                </Label>
                <select
                  id="import-source-type"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as SourceType)}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)]"
                >
                  <option value="transactions">Transactions (Bank Feeds &amp; Expenses)</option>
                  <option value="customers">Customers / Client Directory</option>
                  <option value="vendors">Vendors / Contractors</option>
                  <option value="invoices">Invoices &amp; Receivables</option>
                  <option value="bills">Bills &amp; Payables</option>
                  <option value="chart_of_accounts">Chart of Accounts</option>
                </select>
              </div>

              {clients.length > 0 && (sourceType === "transactions" || sourceType === "invoices" || sourceType === "bills") ? (
                <div className="space-y-1.5">
                  <Label htmlFor="import-client-id" className="text-xs font-medium">
                    Assign to Client
                  </Label>
                  <select
                    id="import-client-id"
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)]"
                  >
                    <option value="">Auto-create / Detect from CSV</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] p-6 text-center hover:border-[var(--color-primary)] hover:bg-[var(--color-muted)]/40 transition-colors"
              >
                <FileSpreadsheet className="h-8 w-8 text-[var(--color-muted-foreground)] mb-2" />
                {file ? (
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-foreground)]">{file.name}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {(file.size / 1024).toFixed(1)} KB — Click to change file
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-[var(--color-foreground)]">
                      Drop export CSV here, or browse
                    </p>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                      Supports Wave standard exports (e.g. Transactions.csv, Customers.csv)
                    </p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setFile(e.target.files[0]);
                      setError(null);
                    }
                  }}
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Duplicates automatically skipped
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={!file || loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    Import CSV
                  </Button>
                </div>
              </div>
            </form>
          ) : stage === "processing" ? (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-600" />
              <h3 className="text-sm font-semibold">Migrating Accounting Data...</h3>
              <p className="text-xs text-[var(--color-muted-foreground)] max-w-sm mx-auto">
                Parsing columns, mapping accounts, and writing immutable double-entry records.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-4 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <div>
                    <h3 className="text-sm font-semibold">Import Complete</h3>
                    <p className="text-xs">
                      Successfully processed {result?.processedRows ?? 0} rows.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded border border-[var(--color-border)] p-2 bg-[var(--color-muted)]">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Total Rows</div>
                  <div className="text-lg font-bold">{result?.totalRows ?? 0}</div>
                </div>
                <div className="rounded border border-[var(--color-border)] p-2 bg-[var(--color-muted)]">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Imported</div>
                  <div className="text-lg font-bold text-emerald-600">
                    {result ? Object.values(result.created).reduce((a, b) => a + b, 0) : 0}
                  </div>
                </div>
                <div className="rounded border border-[var(--color-border)] p-2 bg-[var(--color-muted)]">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Skipped</div>
                  <div className="text-lg font-bold text-[var(--color-muted-foreground)]">
                    {result ? Object.values(result.skipped).reduce((a, b) => a + b, 0) : 0}
                  </div>
                </div>
              </div>

              {result?.errors && result.errors.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Notice: {result.errors.length} rows were skipped due to formatting:
                  </p>
                  <ul className="mt-1 max-h-24 overflow-y-auto text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                    {result.errors.slice(0, 5).map((e, idx) => (
                      <li key={idx}>
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {rollbackDone ? (
                <p className="text-center text-xs text-amber-600 font-medium">
                  ✓ Import successfully rolled back.
                </p>
              ) : null}

              <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
                {!rollbackDone ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRollback}
                    disabled={rollingBack}
                    className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  >
                    {rollingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Rollback this import
                  </Button>
                ) : <span />}

                <Button size="sm" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
