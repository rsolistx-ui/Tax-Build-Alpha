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
  Upload,
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
type Tab = "folders" | "upload" | "review" | "bank" | "pnl";

type PnlRow = {
  category: string;
  total: number;
  count: number;
  receiptCount: number;
};

type Pnl = {
  income: number;
  expenses: number;
  net: number;
  byCategory: PnlRow[];
  note: string;
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

export function ClientWorkspacePage() {
  const { clientId = "" } = useParams();
  const [client, setClient] = useState<Client | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [review, setReview] = useState<ReviewReceipt[]>([]);
  const [tab, setTab] = useState<Tab>("folders");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [drilldown, setDrilldown] = useState<{ category: string; entries: DrilldownEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [clientData, categoryData, reviewData] = await Promise.all([
        api<{ client: Client }>(`/api/clients/${clientId}`),
        api<{ categories: Category[] }>(`/api/clients/${clientId}/categories`),
        api<{ receipts: ReviewReceipt[] }>(`/api/clients/${clientId}/review`),
      ]);
      setClient(clientData.client);
      setCategories(categoryData.categories);
      setReview(reviewData.receipts);
      if (!selectedFolder && categoryData.categories[0]) setSelectedFolder(categoryData.categories[0].slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadPnl() {
    try {
      const data = await api<Pnl>(`/api/clients/${clientId}/pnl?period=ledger`);
      setPnl(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load P&L");
    }
  }

  useEffect(() => {
    if (tab === "pnl") void loadPnl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId, review.length]);

  async function loadDrilldown(category: string) {
    const data = await api<{ category: string; entries: DrilldownEntry[] }>(
      `/api/clients/${clientId}/pnl/drilldown?category=${encodeURIComponent(category)}`,
    );
    setDrilldown(data);
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api(`/api/clients/${clientId}/receipts`, { method: "POST", body: form });
      }
      setMessage(`Uploaded and processed ${files.length} file(s). Review the evidence before filing.`);
      setTab("review");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
                    onClick={() => setSelectedFolder(category.slug)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--color-muted)]",
                      selectedFolder === category.slug && "bg-[var(--color-muted)] font-medium",
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
          <EmptyState
            icon={Folder}
            title={selectedFolder ? `Folder: ${selectedFolder}` : "Select a folder"}
            description="Approved evidence is organized by category. The P&L is built from filed line items, not unreviewed AI output."
            action={<Button variant="secondary" onClick={() => setTab("upload")}><Upload className="h-4 w-4" /> Upload receipts</Button>}
          />
        </div>
      ) : null}

      {tab === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload tray</CardTitle>
            <CardDescription>
              Photos go through Workers AI Qwen 3.8 27B. PDFs are converted inside Workers AI first. Gemini is an optional fallback.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-6 py-16 text-center hover:bg-[var(--color-muted)]/70">
              <Upload className="mb-3 h-6 w-6 text-[var(--color-muted-foreground)]" />
              <span className="text-sm font-medium">{uploading ? "Extracting and validating…" : "Click or drop receipt files"}</span>
              <span className="mt-1 text-xs text-[var(--color-muted-foreground)]">PNG, JPG, WEBP, PDF · source stays private in R2</span>
              <input type="file" className="hidden" multiple accept="image/*,application/pdf" disabled={uploading} onChange={(e) => void onUpload(e.target.files)} />
            </label>
            {message ? <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">{message}</p> : null}
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
              <div className="space-y-2">
                {(pnl?.byCategory ?? []).map((row) => (
                  <button
                    type="button"
                    key={row.category}
                    onClick={() => void loadDrilldown(row.category)}
                    className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-3 text-left text-sm hover:bg-[var(--color-muted)]/60"
                  >
                    <div>
                      <span className="font-medium capitalize">{row.category}</span>
                      <p className="text-xs text-[var(--color-muted-foreground)]">{row.count} line(s) across {row.receiptCount} receipt(s)</p>
                    </div>
                    <span className="font-medium">${Number(row.total).toFixed(2)}</span>
                  </button>
                ))}
                {!pnl?.byCategory?.length ? <p className="text-sm text-[var(--color-muted-foreground)]">No approved expenses yet. File a reviewed receipt to populate the ledger.</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Source drill-down</CardTitle>
              <CardDescription>{drilldown ? `Showing every filed line behind ${drilldown.category}.` : "Select a P&L category to trace it back to receipt evidence."}</CardDescription>
            </CardHeader>
            <CardContent>
              {drilldown ? (
                <div className="space-y-2">
                  {drilldown.entries.map((entry, index) => (
                    <div key={`${entry.receiptId}-${entry.lineNo ?? index}`} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
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
                </div>
              ) : <p className="text-sm text-[var(--color-muted-foreground)]">Nothing selected.</p>}
            </CardContent>
          </Card>
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
