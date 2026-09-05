import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FileSpreadsheet,
  Folder,
  Inbox,
  LineChart,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

type Category = {
  id: string;
  name: string;
  slug: string;
  is_default: number;
};

type Receipt = {
  id: string;
  filename: string;
  status: string;
  extracted_merchant: string | null;
  extracted_amount: number | null;
  extracted_currency: string | null;
  extracted_category: string | null;
  confidence: number | null;
};

type Client = { id: string; name: string };

type Tab = "folders" | "upload" | "review" | "pnl";

export function ClientWorkspacePage() {
  const { clientId = "" } = useParams();
  const [client, setClient] = useState<Client | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [review, setReview] = useState<Receipt[]>([]);
  const [tab, setTab] = useState<Tab>("folders");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pnl, setPnl] = useState<{
    expenses: number;
    byCategory: { category: string; total: number; count: number }[];
    note: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [c, cats, rev] = await Promise.all([
        api<{ client: Client }>(`/api/clients/${clientId}`),
        api<{ categories: Category[] }>(`/api/clients/${clientId}/categories`),
        api<{ receipts: Receipt[] }>(`/api/clients/${clientId}/review`),
      ]);
      setClient(c.client);
      setCategories(cats.categories);
      setReview(rev.receipts);
      if (!selectedFolder && cats.categories[0]) {
        setSelectedFolder(cats.categories[0].slug);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadPnl() {
    const data = await api<{
      expenses: number;
      byCategory: { category: string; total: number; count: number }[];
      note: string;
    }>(`/api/clients/${clientId}/pnl?period=monthly`);
    setPnl(data);
  }

  useEffect(() => {
    if (tab === "pnl") void loadPnl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientId]);

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/clients/${clientId}/receipts`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Upload failed");
        }
      }
      setMessage(`Uploaded ${files.length} file(s). Check Review inbox.`);
      setTab("review");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const tabs = useMemo(
    () =>
      [
        { id: "folders" as const, label: "Folders", icon: Folder },
        { id: "upload" as const, label: "Upload", icon: Upload },
        { id: "review" as const, label: "Review", icon: Inbox, count: review.length },
        { id: "pnl" as const, label: "P&L", icon: LineChart },
      ] as const,
    [review.length],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All clients
        </Link>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{client?.name ?? "Workspace"}</h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Folders · receipts · review · monthly P&amp;L
            </p>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] sm:flex-none",
              tab === t.id && "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {"count" in t && t.count ? (
              <Badge className="bg-stone-200 text-stone-700">{t.count}</Badge>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "folders" ? (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Categories
            </p>
            <ul className="space-y-0.5">
              {categories.map((cat) => (
                <li key={cat.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedFolder(cat.slug)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--color-muted)]",
                      selectedFolder === cat.slug && "bg-[var(--color-muted)] font-medium",
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                    {cat.name}
                    {cat.is_default ? (
                      <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">default</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <EmptyState
            icon={Folder}
            title={selectedFolder ? `Folder: ${selectedFolder}` : "Select a folder"}
            description="Filed receipts will appear here. Upload photos or PDFs, extract with AI, then file from Review."
            action={
              <Button variant="secondary" onClick={() => setTab("upload")}>
                <Upload className="h-4 w-4" />
                Upload receipts
              </Button>
            }
          />
        </div>
      ) : null}

      {tab === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload tray</CardTitle>
            <CardDescription>
              Drop receipt photos or PDFs. Files go to R2, then a job stub runs the LLM adapter (mock or Gemini).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-6 py-16 text-center hover:bg-[var(--color-muted)]/70">
              <Upload className="mb-3 h-6 w-6 text-[var(--color-muted-foreground)]" />
              <span className="text-sm font-medium">
                {uploading ? "Uploading…" : "Click or drop files"}
              </span>
              <span className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                PNG, JPG, WEBP, PDF — Worker forwards bytes to Gemini (no heavy PDF CPU)
              </span>
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={(e) => void onUpload(e.target.files)}
              />
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
            description="Extracted receipts land here for you to confirm merchant, amount, and category before filing."
            action={
              <Button variant="secondary" onClick={() => setTab("upload")}>
                Upload something
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {review.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{r.extracted_merchant || r.filename}</p>
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {r.extracted_amount != null
                        ? `${r.extracted_currency || "USD"} ${Number(r.extracted_amount).toFixed(2)}`
                        : "Amount pending"}
                      {r.extracted_category ? ` · ${r.extracted_category}` : ""}
                      {r.confidence != null ? ` · ${Math.round(r.confidence * 100)}% conf.` : ""}
                    </p>
                  </div>
                  <Badge>Needs review</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === "pnl" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Monthly P&amp;L
            </CardTitle>
            <CardDescription>{pnl?.note ?? "Loading…"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-[var(--color-muted)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">Income</p>
                <p className="mt-1 text-xl font-semibold">$0.00</p>
              </div>
              <div className="rounded-lg bg-[var(--color-muted)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">Expenses</p>
                <p className="mt-1 text-xl font-semibold">
                  ${(pnl?.expenses ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-muted)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">Net</p>
                <p className="mt-1 text-xl font-semibold">
                  ${(-1 * (pnl?.expenses ?? 0)).toFixed(2)}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {(pnl?.byCategory ?? []).map((row) => (
                <div
                  key={row.category}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <span className="capitalize">{row.category}</span>
                  <span className="text-[var(--color-muted-foreground)]">
                    {row.count} · ${Number(row.total).toFixed(2)}
                  </span>
                </div>
              ))}
              {!pnl?.byCategory?.length ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No categorized expenses yet. PDF/Excel export arrives in a later milestone.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
