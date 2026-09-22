import { useState, useRef, useEffect } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

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

interface MigrationProof {
  sourceRowCount: number;
  duplicateCandidateCount: number;
  readyForMappedImport: boolean;
  findings: Array<{ row: number | null; severity: "error" | "warning"; message: string }>;
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
  const [stage, setStage] = useState<"select" | "processing" | "proof" | "applying">("select");
  const [proof, setProof] = useState<MigrationProof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      void loadClients();
      setStage("select");
      setProof(null);
      setError(null);
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

  function handleFileDrop(e: React.DragEvent<HTMLElement>) {
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
      setError("Please select an exported CSV file to assess.");
      return;
    }

    setLoading(true);
    setStage("processing");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sourceType", sourceType);
      const response = await api<{ proof: MigrationProof }>("/api/wave-import/proof", {
        method: "POST",
        body: formData,
      });
      setProof(response.proof);
      setStage("proof");
    } catch (err: any) {
      setError(err?.message || "Failed to assess file. Please verify CSV formatting.");
      setStage("select");
    } finally {
      setLoading(false);
    }
  }

  async function applyImport() {
    if (!file) {
      setError("Select an exported CSV file to import.");
      return;
    }
    if (sourceType === "transactions" && !selectedClientId) {
      setError("Select the client whose books will receive these transactions.");
      return;
    }
    setStage("applying");
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedClientId) formData.append("clientId", selectedClientId);
      if (sourceType !== "transactions") formData.append("sourceType", sourceType);
      await api(sourceType === "transactions" ? "/api/wave-import/transactions/apply" : "/api/wave-import/apply", { method: "POST", body: formData });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply this migration.");
      setStage("proof");
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="csv-migration-title" aria-describedby="csv-migration-description" className="w-full max-w-lg">
      <Card className="relative w-full border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          data-dialog-autofocus
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
              <CardTitle id="csv-migration-title" className="text-base">CSV Migration Proof</CardTitle>
              <CardDescription id="csv-migration-description" className="text-xs">
                Analyze a source export before any data is written. Nothing in this step changes the books.
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
              <button
                type="button"
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
              </button>

              <div className="flex items-center justify-between pt-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Read-only assessment — no rows written
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={!file || loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    Analyze CSV
                  </Button>
                </div>
              </div>
            </form>
          ) : stage === "processing" ? (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-600" />
              <h3 className="text-sm font-semibold">Analyzing source export…</h3>
              <p className="text-xs text-[var(--color-muted-foreground)] max-w-sm mx-auto">
                Checking the header, required values, and duplicate candidates. No accounting data is being written.
              </p>
            </div>
          ) : stage === "proof" ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-4 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <div>
                    <h3 className="text-sm font-semibold">Migration proof complete</h3>
                    <p className="text-xs">
                      No source rows were written to Truepost.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded border border-[var(--color-border)] p-2 bg-[var(--color-muted)]">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Total Rows</div>
                  <div className="text-lg font-bold">{proof?.sourceRowCount ?? 0}</div>
                </div>
                <div className="rounded border border-[var(--color-border)] p-2 bg-[var(--color-muted)]">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Duplicate candidates</div>
                  <div className="text-lg font-bold text-amber-600">{proof?.duplicateCandidateCount ?? 0}</div>
                </div>
                <div className="rounded border border-[var(--color-border)] p-2 bg-[var(--color-muted)]">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Ready for mapping</div>
                  <div className="text-lg font-bold text-emerald-600">{proof?.readyForMappedImport ? "Yes" : "No"}</div>
                </div>
              </div>

              {proof?.findings && proof.findings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Review before import: {proof.findings.length} finding{proof.findings.length === 1 ? "" : "s"}.
                  </p>
                  <ul className="mt-1 max-h-24 overflow-y-auto text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                    {proof.findings.slice(0, 5).map((finding, idx) => (
                      <li key={idx}>
                        {finding.row ? `Row ${finding.row}: ` : ""}{finding.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
                <Button size="sm" variant="outline" onClick={() => setStage("select")}>
                  Analyze another file
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={onClose}>Done</Button>
                  <Button size="sm" disabled={!proof?.readyForMappedImport || loading || (sourceType === "transactions" && !selectedClientId)} onClick={() => void applyImport()}>
                    {sourceType === "transactions" ? "Apply reviewed transaction migration" : "Import as draft records"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-[#0c4eb3]" />
              <h3 className="text-sm font-semibold">Writing reviewed migration records…</h3>
              <p className="text-xs text-[var(--color-muted-foreground)] max-w-sm mx-auto">Transactions remain unreviewed. Invoices and bills are imported as drafts and are never sent or posted automatically.</p>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
