import React, { useState, useMemo, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  X,
  Check,
  Square,
  MinusSquare,
  ExternalLink,
  FileText,
  Landmark,
  MoreHorizontal,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type AccountingClass = "expense" | "income" | "transfer" | "owner_contribution" | "owner_draw" | "needs_review";
type Treatment = "business" | "personal";

type LedgerEntry = {
  id: string;
  periodKey: string;
  date: string | null;
  description: string;
  amount: number;
  currency: string;
  accountingClass: AccountingClass;
  treatment: Treatment;
  category: { id: string; name: string; slug: string } | null;
  source: {
    bankTransaction: { id: string; description: string; date: string } | null;
    receipt: {
      id: string;
      merchant: string;
      total: number | null;
      date: string;
      filename: string;
      sourceUrl: string;
    } | null;
  };
  createdAt: string;
  reviewedAt: string | null;
  closedAt: string | null;
};

type Filters = {
  search: string;
  class: AccountingClass | "all";
  treatment: Treatment | "all";
  categoryId: string | "all";
  period: string | "all";
  status: "open" | "closed" | "all";
};

const CLASS_LABELS: Record<AccountingClass, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  owner_contribution: "Owner Contribution",
  owner_draw: "Owner Draw",
  needs_review: "Needs Review",
};

const CLASS_BADGE_VARIANTS: Record<AccountingClass, "default" | "secondary" | "destructive" | "outline" | "success"> = {
  expense: "destructive",
  income: "success",
  transfer: "outline",
  owner_contribution: "secondary",
  owner_draw: "secondary",
  needs_review: "default",
};

export function TransactionsTable({
  clientId,
  initialPeriod,
  onPeriodChange,
}: {
  clientId: string;
  initialPeriod?: string;
  onPeriodChange?: (period: string) => void;
}) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    search: "",
    class: "all",
    treatment: "all",
    categoryId: "all",
    period: initialPeriod || "all",
    status: "all",
  });
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

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

  async function loadPeriods() {
    try {
      const data = await api<{ periods: string[] }>(`/api/clients/${clientId}/ledger/periods`);
      setPeriods(data.periods);
    } catch {
      // ignore
    }
  }

  async function loadEntries() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));
      if (filters.search) params.set("search", filters.search);
      if (filters.class !== "all") params.set("class", filters.class);
      if (filters.treatment !== "all") params.set("treatment", filters.treatment);
      if (filters.categoryId !== "all") params.set("categoryId", filters.categoryId);
      if (filters.period !== "all") params.set("period", filters.period);

      const data = await api<{ entries: LedgerEntry[]; total: number }>(
        `/api/clients/${clientId}/ledger?${params.toString()}`,
      );
      setEntries(data.entries);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
    loadPeriods();
  }, [clientId]);

  useEffect(() => {
    loadEntries();
    setPage(0);
    setSelectedIds(new Set());
  }, [clientId, filters, page]);

  const allSelected = entries.length > 0 && entries.every((e) => selectedIds.has(e.id));
  const someSelected = entries.some((e) => selectedIds.has(e.id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)));
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const filteredEntries = useMemo(() => entries, [entries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-muted-foreground)]">
            {total} transaction{total !== 1 ? "s" : ""}
            {selectedIds.size > 0 && (
              <> &middot; <span className="font-medium">{selectedIds.size} selected</span></>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
            <Input
              placeholder="Search description, merchant..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="w-[280px] pl-9 h-9 text-sm"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            Filters
          </Button>
          {selectedIds.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  Batch ({selectedIds.size})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => batchClassify("expense")}>
                  Classify as Expense
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => batchClassify("income")}>
                  Classify as Income
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => batchClassify("transfer")}>
                  Classify as Transfer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => batchClassify("owner_contribution")}>
                  Classify as Owner Contribution
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => batchClassify("owner_draw")}>
                  Classify as Owner Draw
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => batchTreatment("business")}>
                  Mark as Business
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => batchTreatment("personal")}>
                  Mark as Personal
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => batchDelete()}>
                  Delete (open periods only)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/30">
          <Select
            value={filters.class}
            onValueChange={(v: string) => setFilters((f) => ({ ...f, class: v as AccountingClass | "all" }))}
          >
            <SelectTrigger className="w-[160px] h-9 text-sm">
              <SelectValue placeholder="Class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {(Object.keys(CLASS_LABELS) as AccountingClass[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {CLASS_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.treatment}
            onValueChange={(v: string) => setFilters((f) => ({ ...f, treatment: v as Treatment | "all" }))}
          >
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <SelectValue placeholder="Treatment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="business">Business</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.categoryId}
            onValueChange={(v: string) => setFilters((f) => ({ ...f, categoryId: v }))}
          >
            <SelectTrigger className="w-[200px] h-9 text-sm">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.period}
            onValueChange={(v: string) => {
              setFilters((f) => ({ ...f, period: v }));
              onPeriodChange?.(v);
            }}
          >
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Periods</SelectItem>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setShowFilters(false)}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/50">
                <th className="w-10 px-3 py-2 text-center">
                  <RowCheckbox
                    checked={allSelected ? "all" : someSelected ? "some" : "none"}
                    onCheckedChange={toggleSelectAll}
                    label="Select all"
                  />
                </th>
                <th className="w-10 px-2"></th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Date</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Description</th>
                <th className="px-3 py-2 text-right font-medium text-[var(--color-muted-foreground)]">Amount</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Class</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Treatment</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Category</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Source</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Period</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-[var(--color-muted-foreground)]">
                    Loading...
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-[var(--color-muted-foreground)]">
                    No transactions found
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <React.Fragment key={entry.id}>
                    <tr
                      className={cn(
                        "hover:bg-[var(--color-muted)]/50 transition-colors",
                        selectedIds.has(entry.id) && "bg-[var(--color-primary)]/5",
                        entry.closedAt && "opacity-60",
                      )}
                    >
                      <td className="px-3 py-2 text-center">
                        <RowCheckbox
                          checked={selectedIds.has(entry.id) ? "all" : "none"}
                          onCheckedChange={() => toggleSelect(entry.id)}
                          disabled={!!entry.closedAt}
                          label={`Select ${entry.description}`}
                        />
                      </td>
                      <td className="px-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleExpand(entry.id)}
                          aria-label={expandedId === entry.id ? "Collapse" : "Expand"}
                        >
                          {expandedId === entry.id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted-foreground)]">
                        {entry.date ? format(new Date(entry.date), "MMM d, yyyy") : "\u2014"}
                      </td>
                      <td className="px-3 py-2 max-w-[300px]">
                        <div className="font-medium truncate">{entry.description}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">
                        {entry.amount >= 0 ? "+" : ""}${entry.amount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={CLASS_BADGE_VARIANTS[entry.accountingClass] || "outline"}
                          className="text-xs gap-1"
                        >
                          {CLASS_LABELS[entry.accountingClass] || entry.accountingClass}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={entry.treatment === "business" ? "default" : "outline"}
                          className="text-xs"
                        >
                          {entry.treatment === "business" ? "Business" : "Personal"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {entry.category ? (
                          <span className="text-[var(--color-foreground)]">{entry.category.name}</span>
                        ) : (
                          <span className="text-[var(--color-muted-foreground)]">\u2014</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {entry.source.bankTransaction && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Landmark className="h-2.5 w-2.5" />
                              Bank
                            </Badge>
                          )}
                          {entry.source.receipt && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <FileText className="h-2.5 w-2.5" />
                              Receipt
                            </Badge>
                          )}
                          {!entry.source.bankTransaction && !entry.source.receipt && (
                            <span className="text-xs text-[var(--color-muted-foreground)]">Manual</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted-foreground)]">
                        {entry.periodKey}
                      </td>
                      <td className="px-3 py-2">
                        {entry.closedAt ? (
                          <Badge variant="secondary" className="text-xs">
                            Closed
                          </Badge>
                        ) : entry.accountingClass === "needs_review" ? (
                          <Badge variant="destructive" className="text-xs">
                            Needs Review
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Open
                          </Badge>
                        )}
                      </td>
                    </tr>
                    {expandedId === entry.id && (
                      <tr className="bg-[var(--color-muted)]/30">
                        <td colSpan={11} className="px-4 py-3">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <DetailRow label="Entry ID" value={entry.id} />
                            <DetailRow label="Created" value={entry.createdAt ? format(new Date(entry.createdAt), "PPp") : "\u2014"} />
                            <DetailRow label="Reviewed" value={entry.reviewedAt ? format(new Date(entry.reviewedAt), "PPp") : "\u2014"} />
                            <DetailRow label="Period" value={entry.periodKey} />
                            {entry.source.bankTransaction && (
                              <DetailRow label="Bank Transaction">
                                <a
                                  href={apiUrl(`/api/clients/${clientId}/bank-transactions/${entry.source.bankTransaction.id}`)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline"
                                >
                                  {entry.source.bankTransaction.description}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </DetailRow>
                            )}
                            {entry.source.receipt && (
                              <DetailRow label="Receipt">
                                <a
                                  href={apiUrl(entry.source.receipt.sourceUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline"
                                >
                                  {entry.source.receipt.merchant || entry.source.receipt.filename}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </DetailRow>
                            )}
                            {entry.category && (
                              <DetailRow label="Category" value={entry.category.name} />
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
            <span className="text-sm text-[var(--color-muted-foreground)]">
              Page {page + 1} of {Math.ceil(total / pageSize)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= Math.ceil(total / pageSize) - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-lg">
          <span className="text-sm text-[var(--color-muted-foreground)]">
            {selectedIds.size} selected
          </span>
          <Button variant="outline" size="sm" onClick={clearSelection}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</span>
      <span className="text-sm text-[var(--color-foreground)]">{children ?? value}</span>
    </div>
  );
}

function RowCheckbox({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: "all" | "none" | "some";
  onCheckedChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === "all" ? "true" : checked === "some" ? "mixed" : "false"}
      aria-label={label}
      disabled={disabled}
      onClick={onCheckedChange}
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-background)] transition-colors",
        checked === "all" && "bg-[var(--color-primary)] border-[var(--color-primary)] text-white",
        checked === "some" && "bg-[var(--color-primary)] border-[var(--color-primary)] text-white",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {checked === "all" && <Check className="h-3 w-3" />}
      {checked === "some" && <MinusSquare className="h-3 w-3" />}
      {checked === "none" && <Square className="h-3 w-3" />}
    </button>
  );
}

function batchClassify(_accountingClass: AccountingClass) {
  // Will be implemented with batch API
}

function batchTreatment(_treatment: Treatment) {
  // Will be implemented with batch API
}

function batchDelete() {
  // Will be implemented with batch API
}