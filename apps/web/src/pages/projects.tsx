import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FolderKanban, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled";

type Project = {
  id: string;
  clientId: string;
  engagementId: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  budgetAmount: number | null;
  budgetCurrency: string;
  color: string;
  isBillable: boolean;
};

type ProjectTag = { id: string; projectId: string; name: string; color: string };

type PnlTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "revenue" | "expense";
};

type ProjectPnL = {
  project: Project;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  budgetRevenue: number;
  budgetExpenses: number;
  varianceRevenue: number;
  varianceExpenses: number;
  transactions: PnlTransaction[];
};

type PnlSummary = {
  periodStart: string;
  periodEnd: string;
  projects: ProjectPnL[];
  totals: { revenue: number; expenses: number; netIncome: number; budgetRevenue: number; budgetExpenses: number };
};

type AutoTagRule = {
  id: string;
  projectId: string;
  tagId: string;
  ruleType: "merchant" | "category" | "description" | "amount_range";
  matchValue: string;
  matchOperator: string;
  priority: number;
  isActive: boolean;
};

type BudgetSnapshot = {
  id: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  budgetRevenue: number;
  budgetExpenses: number;
};

type ClientRow = { id: string; name: string };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function money(value: number): string {
  return usd.format(value);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type RangeId = "ytd" | "last90" | "month";

function rangeFor(id: RangeId): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const end = toISODate(now);
  if (id === "last90") {
    const start = new Date(now);
    start.setDate(start.getDate() - 90);
    return { periodStart: toISODate(start), periodEnd: end };
  }
  if (id === "month") {
    return { periodStart: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), periodEnd: end };
  }
  return { periodStart: toISODate(new Date(now.getFullYear(), 0, 1)), periodEnd: end };
}

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: "bg-[var(--color-success-bg)] text-[var(--color-success)] border-transparent",
  on_hold: "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-transparent",
  completed: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  cancelled: "bg-[#fdecec] text-[var(--color-destructive)] border-transparent",
};

const TAG_SWATCHES = ["#57534e", "#6b8f71", "#b45309", "#475569", "#a16207", "#8674a1"];

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function exportProjectCsv(pnl: ProjectPnL) {
  const lines = [
    "Project,Period,Revenue,Expenses,Net income,Budget revenue,Budget expenses,Variance revenue,Variance expenses",
    [
      csvEscape(pnl.project.name),
      `${pnl.periodStart} to ${pnl.periodEnd}`,
      pnl.revenue,
      pnl.expenses,
      pnl.netIncome,
      pnl.budgetRevenue,
      pnl.budgetExpenses,
      pnl.varianceRevenue,
      pnl.varianceExpenses,
    ].join(","),
    "",
    "Date,Description,Type,Amount",
    ...pnl.transactions.map((t) =>
      [t.date, csvEscape(t.description ?? ""), t.type, t.amount].join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${pnl.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${pnl.periodStart}-to-${pnl.periodEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function MeterRow({ label, actual, budget }: { label: string; actual: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, Math.round((actual / budget) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
        <span className="text-sm tabular-nums">
          {money(actual)}
          <span className="text-xs text-[var(--color-muted-foreground)]"> / {money(budget)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--color-muted)]">
        <div
          className={cn(
            "h-1.5 rounded-full",
            pct > 100 ? "bg-[var(--color-warning)]" : "bg-[var(--color-foreground)]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {budget > 0 ? (
        <p className="mt-1 text-[10px] text-[var(--color-muted-foreground)]">{pct}% of budget</p>
      ) : null}
    </div>
  );
}

function ProjectDetail({
  pnl,
  clientName,
  onChanged,
}: {
  pnl: ProjectPnL;
  clientName: string;
  onChanged: () => void;
}) {
  const project = pnl.project;
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [rules, setRules] = useState<AutoTagRule[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(TAG_SWATCHES[0]);
  const [ruleTagId, setRuleTagId] = useState("");
  const [ruleType, setRuleType] = useState<AutoTagRule["ruleType"]>("merchant");
  const [ruleOperator, setRuleOperator] = useState("contains");
  const [ruleValue, setRuleValue] = useState("");
  const [budgetStart, setBudgetStart] = useState(pnl.periodStart);
  const [budgetEnd, setBudgetEnd] = useState(pnl.periodEnd);
  const [budgetRevenue, setBudgetRevenue] = useState("");
  const [budgetExpenses, setBudgetExpenses] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    setDetailError(null);
    try {
      const [detail, budgetList, ruleList] = await Promise.all([
        api<{ project: Project; tags: ProjectTag[] }>(
          `/api/projects/${project.clientId}/projects/${project.id}`,
        ),
        api<{ snapshots: BudgetSnapshot[] }>(
          `/api/projects/${project.clientId}/projects/${project.id}/budget`,
        ),
        api<{ rules: AutoTagRule[] }>(`/api/projects/${project.clientId}/auto-tag-rules`),
      ]);
      setTags(detail.tags);
      setSnapshots(budgetList.snapshots);
      setRules(ruleList.rules.filter((r) => r.projectId === project.id));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load project detail");
    }
  }, [project.clientId, project.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function addTag(e: FormEvent) {
    e.preventDefault();
    if (!tagName.trim()) return;
    setBusy(true);
    try {
      await api(`/api/projects/${project.clientId}/projects/${project.id}/tags`, {
        method: "POST",
        body: JSON.stringify({ name: tagName.trim(), color: tagColor }),
      });
      setTagName("");
      await loadDetail();
      onChanged();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to add tag");
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tagId: string) {
    setBusy(true);
    try {
      await api(`/api/projects/${project.clientId}/projects/${project.id}/tags/${tagId}`, {
        method: "DELETE",
      });
      await loadDetail();
      onChanged();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to delete tag");
    } finally {
      setBusy(false);
    }
  }

  async function addRule(e: FormEvent) {
    e.preventDefault();
    if (!ruleTagId || !ruleValue.trim()) return;
    setBusy(true);
    try {
      await api(`/api/projects/${project.clientId}/auto-tag-rules`, {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          tagId: ruleTagId,
          ruleType,
          matchValue: ruleValue.trim(),
          matchOperator: ruleOperator,
        }),
      });
      setRuleValue("");
      await loadDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to add rule");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(ruleId: string) {
    setBusy(true);
    try {
      await api(`/api/projects/${project.clientId}/auto-tag-rules/${ruleId}`, { method: "DELETE" });
      await loadDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to delete rule");
    } finally {
      setBusy(false);
    }
  }

  async function saveBudget(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/projects/${project.clientId}/projects/${project.id}/budget`, {
        method: "POST",
        body: JSON.stringify({
          periodStart: budgetStart,
          periodEnd: budgetEnd,
          budgetRevenue: Number(budgetRevenue || 0),
          budgetExpenses: Number(budgetExpenses || 0),
        }),
      });
      await loadDetail();
      onChanged();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: ProjectStatus) {
    setBusy(true);
    try {
      await api(`/api/projects/${project.clientId}/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject() {
    if (!window.confirm(`Delete "${project.name}"? Tags, rules and budgets are removed with it.`)) return;
    setBusy(true);
    try {
      await api(`/api/projects/${project.clientId}/projects/${project.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setBusy(false);
    }
  }

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  return (
    <div className="bg-[var(--color-muted)]/50 px-5 py-6">
      {detailError ? (
        <p className="mb-4 text-sm text-[var(--color-destructive)]">{detailError}</p>
      ) : null}
      <div className="grid gap-8 md:grid-cols-3">
        <section className="space-y-5">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Budget vs actual
            </h3>
            <div className="mt-3 space-y-4">
              <MeterRow label="Revenue" actual={pnl.revenue} budget={pnl.budgetRevenue} />
              <MeterRow label="Expenses" actual={pnl.expenses} budget={pnl.budgetExpenses} />
            </div>
          </div>
          <form className="space-y-2" onSubmit={saveBudget}>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Set budget snapshot
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label="Budget period start"
                type="date"
                value={budgetStart}
                onChange={(e) => setBudgetStart(e.target.value)}
                required
              />
              <Input
                aria-label="Budget period end"
                type="date"
                value={budgetEnd}
                onChange={(e) => setBudgetEnd(e.target.value)}
                required
              />
              <Input
                aria-label="Budget revenue"
                inputMode="decimal"
                placeholder="Budget revenue"
                value={budgetRevenue}
                onChange={(e) => setBudgetRevenue(e.target.value)}
              />
              <Input
                aria-label="Budget expenses"
                inputMode="decimal"
                placeholder="Budget expenses"
                value={budgetExpenses}
                onChange={(e) => setBudgetExpenses(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" disabled={busy}>
              Save budget
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-4">
            <label className="text-xs text-[var(--color-muted-foreground)]">
              Status
              <select
                className="ml-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-sm"
                value={project.status}
                onChange={(e) => void changeStatus(e.target.value as ProjectStatus)}
                disabled={busy}
              >
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <Button variant="ghost" size="sm" className="text-[var(--color-destructive)]" onClick={() => void deleteProject()} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
          {snapshots.length > 0 ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {snapshots.length} budget snapshot{snapshots.length === 1 ? "" : "s"} on file
            </p>
          ) : null}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Transactions ({pnl.transactions.length})
            </h3>
            <button
              type="button"
              onClick={() => exportProjectCsv(pnl)}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>
          {pnl.transactions.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
              No tagged transactions in this period.
            </p>
          ) : (
            <div className="mt-3 max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--color-border)]">
                  {pnl.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 pr-3 text-xs tabular-nums text-[var(--color-muted-foreground)]">{t.date}</td>
                      <td className="py-2 pr-3">{t.description || "—"}</td>
                      <td className="py-2 text-right tabular-nums">
                        <span className={t.type === "revenue" ? "text-[var(--color-success)]" : ""}>
                          {t.type === "revenue" ? "" : "−"}
                          {money(t.amount)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
            Net {money(pnl.netIncome)} · client {clientName}
          </p>
        </section>

        <section className="space-y-6">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Tags
            </h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">No tags yet.</p>
              ) : (
                tags.map((t) => (
                  <span
                    key={t.id}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] py-0.5 pl-2 pr-1 text-xs"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                    {t.name}
                    <button
                      type="button"
                      aria-label={`Delete tag ${t.name}`}
                      onClick={() => void removeTag(t.id)}
                      className="rounded-full px-1 text-[var(--color-muted-foreground)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-destructive)]"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
            <form className="mt-3 flex items-center gap-2" onSubmit={addTag}>
              <Input
                aria-label="New tag name"
                className="h-8 max-w-[160px]"
                placeholder="Tag name"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
              />
              <div className="flex items-center gap-1">
                {TAG_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Tag color ${hex}`}
                    onClick={() => setTagColor(hex)}
                    className={cn(
                      "h-4 w-4 rounded-full border border-transparent transition",
                      tagColor === hex && "ring-2 ring-[var(--color-ring)] ring-offset-1",
                    )}
                    style={{ background: hex }}
                  />
                ))}
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={busy || !tagName.trim()}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </form>
          </div>

          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Auto-tag rules
            </h3>
            {rules.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
                No rules. Rules tag matching transactions automatically.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {rules.map((r) => (
                  <li
                    key={r.id}
                    className="group flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {tagById.get(r.tagId) ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: tagById.get(r.tagId)!.color }}
                        />
                      ) : null}
                      <span className="truncate">
                        {r.ruleType} {r.matchOperator === "contains" ? "has" : r.matchOperator}{" "}
                        “{r.matchValue}”
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label="Delete rule"
                      onClick={() => void removeRule(r.id)}
                      className="text-[var(--color-muted-foreground)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-destructive)]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="mt-3 grid grid-cols-2 items-end gap-2" onSubmit={addRule}>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Tag
                </Label>
                <select
                  aria-label="Rule tag"
                  className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
                  value={ruleTagId}
                  onChange={(e) => setRuleTagId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Field
                </Label>
                <select
                  aria-label="Rule field"
                  className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as AutoTagRule["ruleType"])}
                >
                  <option value="merchant">Merchant</option>
                  <option value="category">Category</option>
                  <option value="description">Description</option>
                  <option value="amount_range">Amount</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Match
                </Label>
                <select
                  aria-label="Rule operator"
                  className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
                  value={ruleOperator}
                  onChange={(e) => setRuleOperator(e.target.value)}
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="starts_with">starts with</option>
                  <option value="ends_with">ends with</option>
                  <option value="regex">regex</option>
                  <option value="between">between (min,max)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Value
                </Label>
                <Input
                  aria-label="Rule value"
                  className="h-8 text-xs"
                  placeholder="office"
                  value={ruleValue}
                  onChange={(e) => setRuleValue(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={busy || !ruleTagId || !ruleValue.trim()}>
                <Plus className="h-3.5 w-3.5" />
                Add rule
              </Button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const [summary, setSummary] = useState<PnlSummary | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeId, setRangeId] = useState<RangeId>("ytd");
  const [period, setPeriod] = useState(() => rangeFor("ytd"));
  const [showForm, setShowForm] = useState(false);
  const [newClientId, setNewClientId] = useState("");
  const [newName, setNewName] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<PnlSummary>(
        `/api/projects/pnl/summary?periodStart=${period.periodStart}&periodEnd=${period.periodEnd}`,
      );
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<{ clients: ClientRow[] }>("/api/clients")
      .then((d) => setClients(d.clients))
      .catch(() => undefined);
  }, []);

  function selectRange(id: RangeId) {
    setRangeId(id);
    setPeriod(rangeFor(id));
  }

  async function createProject(e: FormEvent) {
    e.preventDefault();
    if (!newClientId || !newName.trim()) return;
    setSaving(true);
    try {
      await api(`/api/projects/${newClientId}/projects`, {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          budgetAmount: newBudget ? Number(newBudget) : undefined,
        }),
      });
      setNewName("");
      setNewBudget("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  const clientNames = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const totals = summary?.totals;
  const projects = summary?.projects ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Profitability by project: tagged revenue and expenses, budgets, and P&L.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} disabled={clients.length === 0}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex divide-x divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
          {(
            [
              ["ytd", "Year to date"],
              ["last90", "Last 90 days"],
              ["month", "This month"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => selectRange(id)}
              className={cn(
                "px-3 py-1.5 text-xs transition",
                rangeId === id
                  ? "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs tabular-nums text-[var(--color-muted-foreground)]">
          {period.periodStart} → {period.periodEnd}
        </span>
      </div>

      {showForm ? (
        <Card>
          <CardContent className="pt-6">
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={createProject}>
              <div className="w-full space-y-2 sm:max-w-[240px]">
                <Label htmlFor="project-client">Client</Label>
                <select
                  id="project-client"
                  className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  required
                >
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  placeholder="2026 Bookkeeping"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="w-full space-y-2 sm:w-[180px]">
                <Label htmlFor="project-budget">Budget (optional)</Label>
                <Input
                  id="project-budget"
                  inputMode="decimal"
                  placeholder="12000"
                  value={newBudget}
                  onChange={(e) => setNewBudget(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={saving || !newClientId || !newName.trim()}>
                {saving ? "Saving…" : "Create"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {loading ? (
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-muted)]" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-muted)]" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project to track profitability by engagement — tag transactions, set budgets, and read a project P&L."
          action={
            <Button onClick={() => setShowForm(true)} disabled={clients.length === 0}>
              <Plus className="h-4 w-4" />
              Add project
            </Button>
          }
        />
      ) : (
        <>
          <section className="grid grid-cols-2 divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] md:grid-cols-4 md:divide-x">
            <div className="p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Active projects
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {projects.filter((p) => p.project.status === "active").length}
              </p>
            </div>
            <div className="border-t border-[var(--color-border)] p-5 md:border-t-0 md:border-l">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Revenue
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {money(totals?.revenue ?? 0)}
              </p>
            </div>
            <div className="border-t border-[var(--color-border)] p-5 md:border-t-0 md:border-l">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Expenses
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {money(totals?.expenses ?? 0)}
              </p>
            </div>
            <div className="border-t border-[var(--color-border)] p-5 md:border-t-0 md:border-l">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Net income
              </p>
              <p
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
                  (totals?.netIncome ?? 0) < 0 && "text-[var(--color-destructive)]",
                  (totals?.netIncome ?? 0) > 0 && "text-[var(--color-success)]",
                )}
              >
                {money(totals?.netIncome ?? 0)}
              </p>
            </div>
          </section>

          <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)]">
            {projects.map((pnl) => {
              const project = pnl.project;
              const expanded = expandedId === project.id;
              const budget = project.budgetAmount ?? 0;
              const usedPct = budget > 0 ? Math.min(100, Math.round((pnl.expenses / budget) * 100)) : 0;
              return (
                <div key={project.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : project.id)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 px-5 py-4 text-left transition hover:bg-[var(--color-muted)]/40 md:grid-cols-[minmax(0,1fr)_92px_100px_100px_150px_28px]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: project.color }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{project.name}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                          {clientNames.get(project.clientId) ?? "Client"}
                          <Badge className={cn("px-2 py-0 text-[10px] uppercase tracking-wide", STATUS_STYLES[project.status])}>
                            {project.status.replace("_", " ")}
                          </Badge>
                        </span>
                      </span>
                    </span>
                    <span className="hidden text-right text-sm tabular-nums md:block">
                      {money(pnl.revenue)}
                    </span>
                    <span className="hidden text-right text-sm tabular-nums md:block">
                      {money(pnl.expenses)}
                    </span>
                    <span
                      className={cn(
                        "hidden text-right text-sm font-medium tabular-nums md:block",
                        pnl.netIncome < 0 && "text-[var(--color-destructive)]",
                        pnl.netIncome > 0 && "text-[var(--color-success)]",
                      )}
                    >
                      {money(pnl.netIncome)}
                    </span>
                    <span className="hidden md:block">
                      <span className="block h-1.5 w-full rounded-full bg-[var(--color-muted)]">
                        <span
                          className={cn(
                            "block h-1.5 rounded-full",
                            usedPct > 100 ? "bg-[var(--color-warning)]" : "bg-[var(--color-foreground)]",
                          )}
                          style={{ width: `${usedPct}%` }}
                        />
                      </span>
                      <span className="mt-1 block text-[10px] text-[var(--color-muted-foreground)]">
                        {budget > 0 ? `${usedPct}% of ${money(budget)} budget` : "No budget"}
                      </span>
                    </span>
                    <span className="text-right text-sm font-medium tabular-nums md:hidden">
                      {money(pnl.netIncome)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition",
                        expanded && "rotate-180",
                      )}
                    />
                  </button>
                  {expanded ? (
                    <ProjectDetail
                      pnl={pnl}
                      clientName={clientNames.get(project.clientId) ?? "—"}
                      onChanged={load}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
