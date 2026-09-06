import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  FileSpreadsheet,
  Folder,
  Inbox,
  Landmark,
  LineChart,
  Settings,
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ReceiptReview, type ReviewReceipt } from "@/components/receipt-review";
import { BankReconciliation } from "@/components/bank-reconciliation";
import { cn } from "@/lib/utils";

type Category = {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
};

type Client = { id: string; name: string };

type ClientProfile = {
  entity_type: string | null;
  industry: string | null;
  state: string | null;
  tax_year: number | null;
  accounting_basis: "cash" | "accrual" | null;
  default_currency: string;
};

type PnlCategoryRow = { category: string; count: number; receiptCount: number; bankCount: number; total: number };
type PnlIncomeCategoryRow = { category: string; count: number; total: number };

type Pnl = {
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
  note?: string;
};

type DrilldownEntry = {
  receiptId: string;
  date: string | null;
  merchant: string | null;
  filename: string;
  lineNo: number | null;
  description: string;
  amount: number;
  sourceUrl: string;
};

type DrilldownBankEntry = {
  bankTransactionId: string;
  date: string | null;
  description: string;
  amount: number;
  noReceiptReason: string | null;
  note: string | null;
};

type FolderReceipt = {
  id: string;
  date: string | null;
  merchant: string | null;
  total: number | null;
  currency: string;
  filename: string;
  category: string;
  sourceUrl: string;
};

type BatchStatus = "pending" | "processing" | "succeeded" | "failed";

type BatchFile = {
  id: string;
  file: File;
  status: BatchStatus;
  error?: string;
};

type Tab = "folders" | "upload" | "review" | "bank" | "pnl";

type PnlPreset = "current_month" | "previous_month" | "ytd" | "tax_year" | "custom";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function presetRange(preset: PnlPreset, taxYear: number | null): { startDate: string; endDate: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (preset === "current_month") {
    return { startDate: isoDate(new Date(year, month, 1)), endDate: isoDate(new Date(year, month + 1, 0)) };
  }
  if (preset === "previous_month") {
    return { startDate: isoDate(new Date(year, month - 1, 1)), endDate: isoDate(new Date(year, month, 0)) };
  }
  if (preset === "tax_year") {
    const ty = taxYear || year;
    return { startDate: `${ty}-01-01`, endDate: `${ty}-12-31` };
  }
  // year to date
  return { startDate: `${year}-01-01`, endDate: isoDate(now) };
}

export function ClientWorkspacePage() {
  const { clientId = "" } = useParams();
  const [client, setClient] = useState<Client | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [review, setReview] = useState<ReviewReceipt[]>([]);
  const [tab, setTab] = useState<Tab>("folders");
  const [selectedFolder, setSelectedFolder] = useState<Category | null>(null);
  const [folderReceipts, setFolderReceipts] = useState<FolderReceipt[]>([]);
  const [folderSort, setFolderSort] = useState<"date" | "merchant">("date");
  const [message, setMessage] = useState<string | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [pnlPreset, setPnlPreset] = useState<PnlPreset>("current_month");
  const [pnlCustomStart, setPnlCustomStart] = useState("");
  const [pnlCustomEnd, setPnlCustomEnd] = useState("");
  const [drilldown, setDrilldown] = useState<{ category: string; entries: DrilldownEntry[]; bankEntries: DrilldownBankEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchFile[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  async function load() {
    setError(null);
    try {
      const [clientData, categoryData, reviewData, profileData] = await Promise.all([
        api<{ client: Client }>(`/api/clients/${clientId}`),
        api<{ categories: Category[] }>(`/api/clients/${clientId}/categories`),
        api<{ receipts: ReviewReceipt[] }>(`/api/clients/${clientId}/review`),
        api<{ profile: ClientProfile | null }>(`/api/clients/${clientId}/profile`),
      ]);
      setClient(clientData.client);
      setCategories(categoryData.categories);
      setReview(reviewData.receipts);
      setProfile(profileData.profile);
      if (!selectedFolder && categoryData.categories[0]) setSelectedFolder(categoryData.categories[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function saveProfile(next: Partial<ClientProfile>) {
    try {
      const data = await api<{ profile: ClientProfile }>(`/api/clients/${clientId}/profile`, {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      setProfile(data.profile);
      setEditingProfile(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the client profile");
    }
  }

  async function loadFolderReceipts(category: Category, sort: "date" | "merchant" = folderSort) {
    setSelectedFolder(category);
    try {
      const data = await api<{ receipts: FolderReceipt[] }>(
        `/api/clients/${clientId}/categories/${category.id}/evidence?sort=${sort}`,
      );
      setFolderReceipts(data.receipts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load folder evidence");
    }
  }

  useEffect(() => {
    if (tab === "folders" && selectedFolder) void loadFolderReceipts(selectedFolder, folderSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedFolder?.id, folderSort]);

  const pnlRange = useMemo(() => {
    if (pnlPreset === "custom") return { startDate: pnlCustomStart, endDate: pnlCustomEnd };
    return presetRange(pnlPreset, profile?.tax_year ?? null);
  }, [pnlPreset, pnlCustomStart, pnlCustomEnd, profile?.tax_year]);

  async function loadPnl() {
    try {
      const params = new URLSearchParams();
      if (pnlRange.startDate) params.set("startDate", pnlRange.startDate);
      if (pnlRange.endDate) params.set("endDate", pnlRange.endDate);
      const data = await api<Pnl>(`/api/clients/${clientId}/pnl?${params.toString()}`);
      setPnl(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load P&L");
    }
  }

  useEffect(() => {
    if (tab === "pnl") void loadPnl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId, pnlRange.startDate, pnlRange.endDate, review.length]);

  async function loadDrilldown(category: string) {
    const params = new URLSearchParams({ category });
    if (pnlRange.startDate) params.set("startDate", pnlRange.startDate);
    if (pnlRange.endDate) params.set("endDate", pnlRange.endDate);
    const data = await api<{ category: string; entries: DrilldownEntry[]; bankEntries: DrilldownBankEntry[] }>(
      `/api/clients/${clientId}/pnl/drilldown?${params.toString()}`,
    );
    setDrilldown(data);
  }

  function addFilesToBatch(files: FileList | null) {
    if (!files?.length) return;
    const next: BatchFile[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "pending",
    }));
    setBatch((current) => [...current, ...next]);
  }

  async function uploadOne(item: BatchFile): Promise<void> {
    setBatch((current) => current.map((b) => (b.id === item.id ? { ...b, status: "processing", error: undefined } : b)));
    try {
      const form = new FormData();
      form.append("file", item.file);
      await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form });
      setBatch((current) => current.map((b) => (b.id === item.id ? { ...b, status: "succeeded" } : b)));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Upload failed";
      setBatch((current) => current.map((b) => (b.id === item.id ? { ...b, status: "failed", error: errorMessage } : b)));
    }
  }

  async function runBatch(items: BatchFile[]) {
    setBatchRunning(true);
    setMessage(null);
    // Sequential on purpose: this is a small alpha upload tray, not a queue
    // system. One failing file is recorded and skipped; it never aborts the
    // rest of the box of receipts.
    for (const item of items) {
      await uploadOne(item);
    }
    setBatchRunning(false);
    await load();
    const succeeded = items.length; // reported per-run below from live state instead
    void succeeded;
  }

  async function startBatchUpload() {
    const pending = batch.filter((b) => b.status === "pending");
    if (pending.length === 0) return;
    await runBatch(pending);
  }

  async function retryFailed() {
    const failed = batch.filter((b) => b.status === "failed");
    if (failed.length === 0) return;
    await runBatch(failed);
  }

  function clearBatch() {
    setBatch((current) => current.filter((b) => b.status === "processing"));
  }

  const batchSummary = useMemo(() => {
    const succeeded = batch.filter((b) => b.status === "succeeded").length;
    const failed = batch.filter((b) => b.status === "failed").length;
    const pending = batch.filter((b) => b.status === "pending").length;
    const processing = batch.filter((b) => b.status === "processing").length;
    return { succeeded, failed, pending, processing, total: batch.length };
  }, [batch]);

  const tabs = useMemo(
    () => [
      { id: "folders" as const, label: "Folders", icon: Folder },
      { id: "upload" as const, label: "Upload", icon: Upload },
      { id: "review" as const, label: "Review", icon: Inbox, count: review.length },
      { id: "bank" as const, label: "Bank", icon: Landmark },
      { id: "pnl" as const, label: "P&L", icon: LineChart },
    ],
    [review.length],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Link to="/" className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
          <ArrowLeft className="h-3.5 w-3.5" /> All clients
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client?.name ?? "Workspace"}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Source evidence · line-item review · bank reconciliation · auditable P&amp;L
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          {editingProfile ? (
            <ProfileEditForm profile={profile} onCancel={() => setEditingProfile(false)} onSave={saveProfile} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 font-medium"><Settings className="h-3.5 w-3.5" /> Client profile</span>
                <span>Entity: <strong>{profile?.entity_type || "Not set"}</strong></span>
                <span>Industry: <strong>{profile?.industry || "Not set"}</strong></span>
                <span>State: <strong>{profile?.state || "Not set"}</strong></span>
                <span>Tax year: <strong>{profile?.tax_year || "Not set"}</strong></span>
                <span>Basis: <strong>{profile?.accounting_basis || "Not set"}</strong></span>
                <span>Currency: <strong>{profile?.default_currency || "USD"}</strong></span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditingProfile(true)}>Edit</Button>
            </>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] sm:flex-none",
              tab === item.id && "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]",
            )}
          >
            <item.icon className="h-3.5 w-3.5" /> {item.label}
            {"count" in item && item.count ? <Badge className="bg-stone-200 text-stone-700">{item.count}</Badge> : null}
          </button>
        ))}
      </div>

      {tab === "folders" ? (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">Categories</p>
            <ul className="space-y-0.5">
              {categories.map((category) => (
                <li key={category.id}>
                  <button
                    type="button"
                    onClick={() => void loadFolderReceipts(category)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--color-muted)]",
                      selectedFolder?.id === category.id && "bg-[var(--color-muted)] font-medium",
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                    {category.name}
                    {category.is_default ? <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">default</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{selectedFolder ? selectedFolder.name : "Select a folder"}</CardTitle>
                  <CardDescription>Filed, professional-approved evidence only. Unreviewed extraction never appears here.</CardDescription>
                </div>
                <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setFolderSort("date")}
                    className={cn("rounded px-2 py-1", folderSort === "date" && "bg-[var(--color-muted)] font-medium")}
                  >
                    Sort by date
                  </button>
                  <button
                    type="button"
                    onClick={() => setFolderSort("merchant")}
                    className={cn("rounded px-2 py-1", folderSort === "merchant" && "bg-[var(--color-muted)] font-medium")}
                  >
                    Sort by merchant
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {folderReceipts.length === 0 ? (
                <EmptyState
                  icon={Folder}
                  title="No filed evidence in this folder yet"
                  description="Approved receipts filed under this category will appear here with their date, merchant, total, and source link."
                  action={<Button variant="secondary" onClick={() => setTab("upload")}><Upload className="h-4 w-4" /> Upload receipts</Button>}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        <th className="pb-2 pr-3">Date</th>
                        <th className="pb-2 pr-3">Merchant</th>
                        <th className="pb-2 pr-3">Total</th>
                        <th className="pb-2 pr-3">File</th>
                        <th className="pb-2">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {folderReceipts.map((receipt) => (
                        <tr key={receipt.id} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="py-2 pr-3">{receipt.date || "\u2014"}</td>
                          <td className="py-2 pr-3">{receipt.merchant || "\u2014"}</td>
                          <td className="py-2 pr-3 font-medium">{receipt.total !== null ? `${receipt.currency} ${receipt.total.toFixed(2)}` : "\u2014"}</td>
                          <td className="py-2 pr-3 truncate max-w-[220px]">{receipt.filename}</td>
                          <td className="py-2">
                            <a href={apiUrl(receipt.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload tray</CardTitle>
            <CardDescription>
              Select a whole box of receipts at once. Photos go through Workers AI extraction; PDFs are converted first. One bad file never blocks the rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-6 py-12 text-center hover:bg-[var(--color-muted)]/70">
              <Upload className="mb-3 h-6 w-6 text-[var(--color-muted-foreground)]" />
              <span className="text-sm font-medium">Click or drop receipt files</span>
              <span className="mt-1 text-xs text-[var(--color-muted-foreground)]">PNG, JPG, WEBP, PDF · select as many as you like</span>
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => {
                  addFilesToBatch(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>

            {batch.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {batchSummary.total} file{batchSummary.total === 1 ? "" : "s"} in this batch
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={batchRunning || batchSummary.pending === 0}
                      onClick={() => void startBatchUpload()}
                    >
                      {batchRunning ? "Uploading…" : `Upload ${batchSummary.pending} pending`}
                    </Button>
                    {batchSummary.failed > 0 ? (
                      <Button size="sm" variant="secondary" disabled={batchRunning} onClick={() => void retryFailed()}>
                        <RotateCcw className="h-3.5 w-3.5" /> Retry {batchSummary.failed} failed
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" disabled={batchRunning} onClick={clearBatch}>
                      Clear finished
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {batch.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                      <BatchStatusBadge status={item.status} error={item.error} />
                    </div>
                  ))}
                </div>

                {!batchRunning && batchSummary.total > 0 && batchSummary.pending === 0 && batchSummary.processing === 0 ? (
                  <div className="rounded-md bg-[var(--color-muted)] p-3 text-sm">
                    <p className="font-medium">Batch summary</p>
                    <p className="mt-1 text-[var(--color-muted-foreground)]">
                      {batchSummary.succeeded} succeeded, {batchSummary.failed} failed. Succeeded receipts are waiting in Review.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {message ? <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{message}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === "review" ? (
        review.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Review inbox is clear"
            description="New extractions land here with their source document, line items, validation checks, and confidence signals."
            action={<Button variant="secondary" onClick={() => setTab("upload")}>Upload something</Button>}
          />
        ) : (
          <ReceiptReview clientId={clientId} categories={categories} receipts={review} onReload={load} />
        )
      ) : null}

      {tab === "bank" ? (
        <BankReconciliation
          clientId={clientId}
          onReceiptAdded={() => void load()}
          onOpenReview={() => {
            setTab("review");
            void load();
          }}
        />
      ) : null}

      {tab === "pnl" ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              {([
                ["current_month", "This month"],
                ["previous_month", "Last month"],
                ["ytd", "Year to date"],
                ["tax_year", "Tax year"],
                ["custom", "Custom range"],
              ] as Array<[PnlPreset, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPnlPreset(value)}
                  className={cn(
                    "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm",
                    pnlPreset === value && "bg-[var(--color-muted)] font-medium",
                  )}
                >
                  {label}
                </button>
              ))}
              {pnlPreset === "custom" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={pnlCustomStart}
                    onChange={(e) => setPnlCustomStart(e.target.value)}
                    className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                  />
                  <span className="text-sm text-[var(--color-muted-foreground)]">to</span>
                  <input
                    type="date"
                    value={pnlCustomEnd}
                    onChange={(e) => setPnlCustomEnd(e.target.value)}
                    className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                  />
                </div>
              ) : (
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {pnlRange.startDate} to {pnlRange.endDate}
                </span>
              )}
            </CardContent>
          </Card>

          {pnl && pnl.accrualSupported === false ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Accrual-basis reporting is not available.</p>
                <p className="mt-0.5 text-xs text-amber-800">{pnl.warning}</p>
              </div>
            </div>
          ) : null}

          {pnl && pnl.completeness && !pnl.completeness.isComplete ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">This report is not complete for the selected period.</p>
                <p className="mt-0.5 text-xs text-amber-800">
                  {pnl.completeness.unclassifiedCount > 0 ? `${pnl.completeness.unclassifiedCount} bank transaction(s) have no accounting disposition yet. ` : ""}
                  {pnl.completeness.unresolvedTriageCount > 0 ? `${pnl.completeness.unresolvedTriageCount} bank transaction(s) are still unresolved in the bank exception inbox. ` : ""}
                  {pnl.completeness.uncategorizedCount > 0 ? `${pnl.completeness.uncategorizedCount} business transaction(s) or receipt line(s) have no category yet. ` : ""}
                  {pnl.completeness.currencyConflictCount > 0 ? `${pnl.completeness.currencyConflictCount} transaction(s) are in a currency other than ${pnl.currency} and are excluded until resolved.` : ""}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> Evidence-backed P&amp;L</CardTitle>
                <CardDescription>{pnl?.note ?? "Loading…"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Summary label="Income" value={pnl?.income ?? 0} />
                  <Summary label="Expenses" value={pnl?.expenses ?? 0} />
                  <Summary label="Net" value={pnl?.net ?? 0} />
                </div>

                {pnl?.counts ? (
                  <div className="flex flex-wrap gap-2 text-xs text-[var(--color-muted-foreground)]">
                    <span>{pnl.counts.filedReceipts} filed receipt(s)</span>
                    <span>·</span>
                    <span>{pnl.counts.matchedBankTransactions} matched bank txn(s)</span>
                    <span>·</span>
                    <span>{pnl.counts.noReceiptBusinessExpenses} no-receipt expense(s)</span>
                    <span>·</span>
                    <span>{pnl.counts.businessIncomeTransactions} income txn(s)</span>
                  </div>
                ) : null}

                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Expenses by category</p>
                  <div className="space-y-2">
                    {(pnl?.categorizedExpenses ?? []).map((row) => (
                      <button
                        type="button"
                        key={row.category}
                        onClick={() => void loadDrilldown(row.category)}
                        className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-3 text-left text-sm hover:bg-[var(--color-muted)]/60"
                      >
                        <div>
                          <span className="font-medium capitalize">{row.category}</span>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {row.receiptCount} receipt line(s){row.bankCount > 0 ? `, ${row.bankCount} no-receipt bank txn(s)` : ""}
                          </p>
                        </div>
                        <span className="font-medium">${Number(row.total).toFixed(2)}</span>
                      </button>
                    ))}
                    {!pnl?.categorizedExpenses?.length ? <p className="text-sm text-[var(--color-muted-foreground)]">No business expenses in this period.</p> : null}
                  </div>
                </div>

                {pnl?.categorizedIncome?.length ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Income by category</p>
                    <div className="space-y-2">
                      {pnl.categorizedIncome.map((row) => (
                        <div key={row.category} className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-3 text-sm">
                          <span className="font-medium capitalize">{row.category}</span>
                          <span className="font-medium">${Number(row.total).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Source drill-down</CardTitle>
                <CardDescription>{drilldown ? `Showing every filed line and no-receipt bank transaction behind ${drilldown.category}.` : "Select a P&L category to trace it back to evidence."}</CardDescription>
              </CardHeader>
              <CardContent>
                {drilldown ? (
                  <div className="space-y-2">
                    {drilldown.entries.map((entry, index) => (
                      <div key={`r-${entry.receiptId}-${entry.lineNo ?? index}`} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{entry.merchant || entry.filename}</p>
                            <p className="truncate text-xs text-[var(--color-muted-foreground)]">{entry.description}{entry.date ? ` · ${entry.date}` : ""}</p>
                          </div>
                          <span className="font-medium">${Number(entry.amount).toFixed(2)}</span>
                        </div>
                        <a href={apiUrl(entry.sourceUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline">View source <ExternalLink className="h-3 w-3" /></a>
                      </div>
                    ))}
                    {drilldown.bankEntries.map((entry) => (
                      <div key={`b-${entry.bankTransactionId}`} className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{entry.description}</p>
                            <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                              No receipt required{entry.date ? ` · ${entry.date}` : ""}
                            </p>
                          </div>
                          <span className="font-medium">${Number(entry.amount).toFixed(2)}</span>
                        </div>
                        {entry.noReceiptReason ? (
                          <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">Reason: {entry.noReceiptReason}</p>
                        ) : null}
                      </div>
                    ))}
                    {drilldown.entries.length === 0 && drilldown.bankEntries.length === 0 ? (
                      <p className="text-sm text-[var(--color-muted-foreground)]">No entries for this category and period.</p>
                    ) : null}
                  </div>
                ) : <p className="text-sm text-[var(--color-muted-foreground)]">Nothing selected.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--color-muted)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</p>
      <p className="mt-1 text-xl font-semibold">${Number(value).toFixed(2)}</p>
    </div>
  );
}

function BatchStatusBadge({ status, error }: { status: BatchStatus; error?: string }) {
  if (status === "pending") return <Badge className="bg-stone-200 text-stone-700">Pending</Badge>;
  if (status === "processing") return <Badge className="bg-blue-100 text-blue-800 gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Processing</Badge>;
  if (status === "succeeded") return <Badge className="bg-emerald-100 text-emerald-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Succeeded</Badge>;
  return (
    <Badge className="bg-red-100 text-red-800 gap-1" title={error}>
      <XCircle className="h-3 w-3" /> Failed
    </Badge>
  );
}

function ProfileEditForm({
  profile,
  onCancel,
  onSave,
}: {
  profile: { entity_type: string | null; industry: string | null; state: string | null; tax_year: number | null; accounting_basis: "cash" | "accrual" | null; default_currency: string } | null;
  onCancel: () => void;
  onSave: (next: Record<string, unknown>) => void;
}) {
  const [entityType, setEntityType] = useState(profile?.entity_type ?? "");
  const [industry, setIndustry] = useState(profile?.industry ?? "");
  const [state, setState] = useState(profile?.state ?? "");
  const [taxYear, setTaxYear] = useState(profile?.tax_year ? String(profile.tax_year) : "");
  const [basis, setBasis] = useState(profile?.accounting_basis ?? "");
  const [currency, setCurrency] = useState(profile?.default_currency ?? "USD");

  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <Field label="Entity type" value={entityType} onChange={setEntityType} />
      <Field label="Industry" value={industry} onChange={setIndustry} />
      <Field label="State" value={state} onChange={setState} />
      <Field label="Tax year" value={taxYear} onChange={setTaxYear} type="number" />
      <label className="space-y-1 text-xs font-medium">
        <span>Accounting basis</span>
        <select value={basis} onChange={(e) => setBasis(e.target.value)} className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal">
          <option value="">Not set</option>
          <option value="cash">Cash</option>
          <option value="accrual">Accrual</option>
        </select>
      </label>
      <Field label="Currency" value={currency} onChange={setCurrency} />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onSave({
            entity_type: entityType || null,
            industry: industry || null,
            state: state || null,
            tax_year: taxYear ? Number(taxYear) : null,
            accounting_basis: basis || null,
            default_currency: currency || "USD",
          })}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="space-y-1 text-xs font-medium">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm font-normal"
      />
    </label>
  );
}
