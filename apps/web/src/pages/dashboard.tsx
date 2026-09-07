import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Inbox,
  LayoutDashboard,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

type Readiness = "ready" | "needs_review" | "missing_evidence" | "books_incomplete";

type ClientRow = {
  id: string;
  name: string;
  legalName: string | null;
  taxYear: number | null;
  accountingBasis: string | null;
  currency: string;
  updatedAt: string;
  readiness: Readiness;
  receiptReviewCount: number;
  missingEvidenceCount: number;
  unresolvedBankExceptionCount: number;
  unclassifiedCount: number;
  uncategorizedCount: number;
  currencyConflictCount: number;
  filedReceiptCount: number;
  isComplete: boolean;
};

type Action = {
  id: string;
  clientId: string;
  clientName: string;
  type: string;
  priority: number;
  explanation: string;
  date: string | null;
  sourceEntityId: string;
  deepLink: string;
};

type Activity = {
  id: string;
  clientId: string;
  clientName: string;
  summary: string;
  createdAt: string;
};

type Summary = {
  clients: number;
  clientsReady: number;
  clientsNeedingAttention: number;
  totalOpenActions: number;
  receiptsAwaitingReview: number;
  missingEvidence: number;
  unresolvedBankExceptions: number;
  unclassifiedTransactions: number;
  uncategorizedActivity: number;
  currencyConflicts: number;
};

type DashboardData = { summary: Summary; clients: ClientRow[]; actions: Action[]; recentActivity: Activity[] };

type Filter = "all" | "needs_attention" | "ready" | "missing_evidence" | "bank_issues" | "receipt_review";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All clients" },
  { id: "needs_attention", label: "Needs attention" },
  { id: "ready", label: "Ready" },
  { id: "missing_evidence", label: "Missing evidence" },
  { id: "bank_issues", label: "Bank issues" },
  { id: "receipt_review", label: "Receipt review" },
];

const READINESS_LABEL: Record<Readiness, string> = {
  ready: "Ready",
  needs_review: "Needs review",
  missing_evidence: "Missing evidence",
  books_incomplete: "Books incomplete",
};

function readinessTone(r: Readiness): { fg: string; bg: string } {
  switch (r) {
    case "ready":
      return { fg: "var(--color-success)", bg: "var(--color-success-bg)" };
    case "needs_review":
      return { fg: "var(--color-warning)", bg: "var(--color-warning-bg)" };
    case "missing_evidence":
    case "books_incomplete":
      return { fg: "var(--color-destructive)", bg: "#fbe7e7" };
  }
}

function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  const tone = readinessTone(readiness);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color: tone.fg, background: tone.bg }}
    >
      {READINESS_LABEL[readiness]}
    </span>
  );
}

export function matchesFilter(row: ClientRow, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return row.readiness === "ready";
    case "needs_attention":
      return row.readiness !== "ready";
    case "missing_evidence":
      return row.missingEvidenceCount > 0;
    case "bank_issues":
      return row.unresolvedBankExceptionCount > 0 || row.unclassifiedCount > 0 || row.currencyConflictCount > 0;
    case "receipt_review":
      return row.receiptReviewCount > 0;
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function SummaryStrip({ summary }: { summary: Summary }) {
  const items: Array<{ label: string; value: number; tone?: "warn" }> = [
    { label: "Clients", value: summary.clients },
    { label: "Ready", value: summary.clientsReady },
    { label: "Needs attention", value: summary.clientsNeedingAttention, tone: summary.clientsNeedingAttention > 0 ? "warn" : undefined },
    { label: "Open actions", value: summary.totalOpenActions, tone: summary.totalOpenActions > 0 ? "warn" : undefined },
    { label: "Receipts to review", value: summary.receiptsAwaitingReview },
    { label: "Missing evidence", value: summary.missingEvidence, tone: summary.missingEvidence > 0 ? "warn" : undefined },
    { label: "Bank exceptions", value: summary.unresolvedBankExceptions, tone: summary.unresolvedBankExceptions > 0 ? "warn" : undefined },
    { label: "Unclassified", value: summary.unclassifiedTransactions, tone: summary.unclassifiedTransactions > 0 ? "warn" : undefined },
    { label: "Uncategorized", value: summary.uncategorizedActivity },
    { label: "Currency conflicts", value: summary.currencyConflicts, tone: summary.currencyConflicts > 0 ? "warn" : undefined },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="bg-[var(--color-card)] px-4 py-3">
          <div
            className="text-xl font-semibold tabular-nums"
            style={item.tone === "warn" ? { color: "var(--color-warning)" } : undefined}
          >
            {item.value}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function QuickActions({ onPickClient }: { onPickClient: (destinationTab: string) => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => navigate("/clients?new=1")}>
        <Plus className="h-3.5 w-3.5" /> Add client
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPickClient("upload")}>
        <Upload className="h-3.5 w-3.5" /> Upload receipts
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPickClient("bank")}>
        Import bank CSV
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPickClient("review")}>
        Review receipts
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPickClient("bank")}>
        Resolve bank exceptions
      </Button>
      <Button size="sm" variant="secondary" onClick={() => navigate("/documents/review")}>
        Review documents
      </Button>
    </div>
  );
}

function ClientPickerModal({
  clients,
  onClose,
  onPick,
}: {
  clients: ClientRow[];
  onClose: () => void;
  onPick: (clientId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = clients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-3 p-4">
          <Input autoFocus placeholder="Search clients..." value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-[var(--color-muted-foreground)]">No clients found</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onPick(c.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--color-muted)]"
                >
                  {c.name}
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [pickerTab, setPickerTab] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await api<DashboardData>("/api/dashboard");
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredClients = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.clients.filter(
      (c) => matchesFilter(c, filter) && (!q || c.name.toLowerCase().includes(q) || (c.legalName ?? "").toLowerCase().includes(q)),
    );
  }, [data, filter, search]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-muted)]" />
        <div className="h-24 animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-muted)]" />
        <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-muted)]" />
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-sm text-[var(--color-destructive)]">{error || "Failed to load"}</p>;
  }

  if (data.summary.clients === 0) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="No clients yet"
        description="Add your first client to start tracking receipts, bank activity, and reporting readiness in one place."
        action={
          <Button onClick={() => navigate("/clients?new=1")}>
            <Plus className="h-4 w-4" /> Add client
          </Button>
        }
      />
    );
  }

  const caughtUp = data.summary.totalOpenActions === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Firm-wide workload across every client's books, evidence, and bank activity.
          </p>
        </div>
        <QuickActions onPickClient={(tab) => setPickerTab(tab)} />
      </div>

      <SummaryStrip summary={data.summary} />

      {caughtUp ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
            <div>
              <p className="text-sm font-medium">You're caught up</p>
              <p className="text-sm text-[var(--color-muted-foreground)]">No client work currently requires attention.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <ClipboardList className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              <h2 className="text-sm font-semibold">Action queue</h2>
              <Badge className="ml-auto">{data.actions.length}</Badge>
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {data.actions.slice(0, 25).map((action) => (
                <li key={action.id}>
                  <Link
                    to={action.deepLink}
                    className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--color-muted)]"
                  >
                    <AlertTriangle
                      className="h-4 w-4 shrink-0"
                      style={{ color: action.priority <= 2 ? "var(--color-destructive)" : "var(--color-warning)" }}
                    />
                    <span className="w-32 shrink-0 truncate font-medium">{action.clientName}</span>
                    <span className="flex-1 truncate text-[var(--color-muted-foreground)]">{action.explanation}</span>
                    <span className="hidden shrink-0 text-xs text-[var(--color-muted-foreground)] sm:inline">
                      {action.date ?? ""}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]",
                  filter === f.id && "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="pl-8"
            />
          </div>
        </div>

        {filteredClients.length === 0 ? (
          <EmptyState icon={FileWarning} title="No clients match" description="Try a different filter or search term." />
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted-foreground)]">
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Tax year</th>
                    <th className="px-4 py-2 font-medium">Currency</th>
                    <th className="px-4 py-2 text-right font-medium">Review</th>
                    <th className="px-4 py-2 text-right font-medium">Missing</th>
                    <th className="px-4 py-2 text-right font-medium">Bank</th>
                    <th className="px-4 py-2 text-right font-medium">Last activity</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-muted)]"
                      onClick={() => navigate(`/clients/${c.id}`)}
                    >
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3">
                        <ReadinessBadge readiness={c.readiness} />
                      </td>
                      <td className="px-4 py-3 text-[var(--color-muted-foreground)]">{c.taxYear ?? "\u2014"}</td>
                      <td className="px-4 py-3 text-[var(--color-muted-foreground)]">{c.currency}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.receiptReviewCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.missingEvidenceCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.unresolvedBankExceptionCount}</td>
                      <td className="px-4 py-3 text-right text-xs text-[var(--color-muted-foreground)]">{timeAgo(c.updatedAt)}</td>
                      <td className="px-2 py-3">
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Mobile cards */}
            <div className="space-y-2 sm:hidden">
              {filteredClients.map((c) => (
                <Card key={c.id} onClick={() => navigate(`/clients/${c.id}`)} className="cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{c.name}</span>
                      <ReadinessBadge readiness={c.readiness} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
                      <span>{c.receiptReviewCount} to review</span>
                      <span>{c.missingEvidenceCount} missing</span>
                      <span>{c.unresolvedBankExceptionCount} bank issues</span>
                      <span>{timeAgo(c.updatedAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {data.recentActivity.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <Inbox className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              <h2 className="text-sm font-semibold">Recent activity</h2>
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {data.recentActivity.slice(0, 15).map((activity) => (
                <li key={activity.id}>
                  <Link
                    to={`/clients/${activity.clientId}`}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--color-muted)]"
                  >
                    <span className="w-32 shrink-0 truncate font-medium">{activity.clientName}</span>
                    <span className="flex-1 truncate text-[var(--color-muted-foreground)]">{activity.summary}</span>
                    <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{timeAgo(activity.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {pickerTab ? (
        <ClientPickerModal
          clients={data.clients}
          onClose={() => setPickerTab(null)}
          onPick={(clientId) => {
            navigate(`/clients/${clientId}?tab=${pickerTab}`);
            setPickerTab(null);
          }}
        />
      ) : null}
    </div>
  );
}
