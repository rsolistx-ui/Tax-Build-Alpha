import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, FileSpreadsheet, Folder, Plus } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

type CategoryRow = { id: string; name: string; slug: string; is_default: boolean };

type PnlCategoryRow = { categoryId: string; category: string; slug: string; total: number; count: number };

type Pnl = {
  period: string;
  income: number;
  expenses: number;
  net: number;
  byCategory: { income: PnlCategoryRow[]; expense: PnlCategoryRow[] };
  note: string;
};

type DrilldownEntry = {
  id: string;
  date: string | null;
  description: string;
  amount: number;
  currency: string;
  category: string | null;
  source: {
    bankTransaction: { id: string; description: string; date: string } | null;
    receipt: { id: string; merchant: string; total: number | null; date: string; filename: string; sourceUrl: string } | null;
  };
};

export function ClientReportsPage() {
  const { clientId = "" } = useParams();
  const { currentPeriod } = useWorkspace();
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [drilldown, setDrilldown] = useState<{ categoryId: string; category: string; accountingClass: string; entries: DrilldownEntry[] } | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [scope, setScope] = useState<"period" | "all">("period");
  const [error, setError] = useState<string | null>(null);

  async function loadPnl() {
    setError(null);
    try {
      const params = scope === "period" && currentPeriod ? `?period=${encodeURIComponent(currentPeriod)}` : "";
      const data = await api<Pnl>(`/api/clients/${clientId}/pnl${params}`);
      setPnl(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load P&L");
    }
  }

  async function loadCategories() {
    try {
      const data = await api<{ categories: CategoryRow[] }>(`/api/clients/${clientId}/categories`);
      setCategories(data.categories);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadPnl();
    void loadCategories();
  }, [clientId, scope, currentPeriod]);

  async function loadDrilldown(row: PnlCategoryRow, accountingClass: "income" | "expense") {
    const params = new URLSearchParams({ categoryId: row.categoryId, class: accountingClass });
    if (scope === "period" && currentPeriod) params.set("period", currentPeriod);
    const data = await api<{ entries: DrilldownEntry[] }>(`/api/clients/${clientId}/pnl/drilldown?${params.toString()}`);
    setDrilldown({ categoryId: row.categoryId, category: row.category, accountingClass, entries: data.entries });
  }

  async function createCategory() {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    setError(null);
    try {
      await api(`/api/clients/${clientId}/categories`, {
        method: "POST",
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });
      setNewCategoryName("");
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create category");
    } finally {
      setCreatingCategory(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Reports</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">Ledger-backed P&amp;L, traced back to its source evidence.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1">
          <Button variant={scope === "period" ? "secondary" : "ghost"} size="sm" onClick={() => setScope("period")}>
            {currentPeriod || "This period"}
          </Button>
          <Button variant={scope === "all" ? "secondary" : "ghost"} size="sm" onClick={() => setScope("all")}>
            All time
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> Evidence-backed P&amp;L</CardTitle>
            <CardDescription>{pnl?.note ?? "Loading…"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Summary label="Income" value={pnl?.income ?? 0} />
              <Summary label="Expenses" value={pnl?.expenses ?? 0} />
              <Summary label="Net" value={pnl?.net ?? 0} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Income by category</p>
              <div className="space-y-2">
                {(pnl?.byCategory.income ?? []).map((row) => (
                  <CategoryRowButton key={row.categoryId} row={row} onClick={() => void loadDrilldown(row, "income")} />
                ))}
                {!pnl?.byCategory.income?.length ? <p className="text-sm text-[var(--color-muted-foreground)]">No business income recorded yet.</p> : null}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Expenses by category</p>
              <div className="space-y-2">
                {(pnl?.byCategory.expense ?? []).map((row) => (
                  <CategoryRowButton key={row.categoryId} row={row} onClick={() => void loadDrilldown(row, "expense")} />
                ))}
                {!pnl?.byCategory.expense?.length ? <p className="text-sm text-[var(--color-muted-foreground)]">No business expenses recorded yet.</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Source drill-down</CardTitle>
              <CardDescription>{drilldown ? `Every ledger row behind ${drilldown.category}.` : "Select a category to trace it back to receipt or bank evidence."}</CardDescription>
            </CardHeader>
            <CardContent>
              {drilldown ? (
                drilldown.entries.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">No entries.</p>
                ) : (
                  <div className="space-y-2">
                    {drilldown.entries.map((entry) => (
                      <div key={entry.id} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{entry.source.receipt?.merchant || entry.source.bankTransaction?.description || entry.description}</p>
                            <p className="truncate text-xs text-[var(--color-muted-foreground)]">{entry.description}{entry.date ? ` · ${entry.date}` : ""}</p>
                          </div>
                          <span className="font-medium">${Number(entry.amount).toFixed(2)}</span>
                        </div>
                        {entry.source.receipt ? (
                          <a href={apiUrl(entry.source.receipt.sourceUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline">
                            View source <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">Nothing selected.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Folder className="h-4 w-4" /> Categories</CardTitle>
              <CardDescription>Categories used to organize P&amp;L and evidence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  className="h-9 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm"
                />
                <Button size="sm" disabled={creatingCategory || !newCategoryName.trim()} onClick={() => void createCategory()}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <ul className="space-y-0.5">
                {categories.map((category) => (
                  <li key={category.id} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm">
                    <Folder className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                    {category.name}
                    {category.is_default ? <Badge className="ml-auto">default</Badge> : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
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

function CategoryRowButton({ row, onClick }: { row: PnlCategoryRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-3 text-left text-sm hover:bg-[var(--color-muted)]/60"
    >
      <div>
        <span className="font-medium">{row.category}</span>
        <p className="text-xs text-[var(--color-muted-foreground)]">{row.count} entr{row.count === 1 ? "y" : "ies"}</p>
      </div>
      <span className="font-medium">${Number(row.total).toFixed(2)}</span>
    </button>
  );
}
