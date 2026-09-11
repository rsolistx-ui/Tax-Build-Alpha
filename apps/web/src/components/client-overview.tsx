import { useEffect, useMemo, useState } from "react";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { presetRange, REPORTING_PERIOD_OPTIONS, type ReportingPeriodPreset } from "@/lib/reporting-period";

type CategoryOption = { id: string; name: string };

type OverviewAction = {
  id: string;
  type: string;
  explanation: string;
  deepLink: string;
  sourceEntityId: string;
};

type FinancialPeriod =
  | { unsupported: true; warning: string; periodStart: string | null; periodEnd: string | null }
  | { unsupported: false; periodStart: string | null; periodEnd: string | null; income: number; expenses: number; net: number };

type Overview = {
  header: {
    clientName: string;
    legalName: string | null;
    entityType: string | null;
    industry: string | null;
    state: string | null;
    taxYear: number | null;
    accountingBasis: string | null;
    reportingCurrency: string;
    bookkeepingReadiness: string;
    taxReadiness: string | null;
    openActionCount: number;
    lastActivityAt: string | null;
  };
  financialStatus: {
    periodStart: string;
    periodEnd: string;
    pnlCompleteness: boolean;
    bankTransactionCount: number;
    resolvedCount: number;
    missingEvidenceCount: number;
    unclassifiedCount: number;
    uncategorizedCount: number;
    currencyConflictCount: number;
  };
  financialPeriod: FinancialPeriod;
  documentStatus: {
    receiptsReceived: number;
    receiptsAwaitingReview: number;
    filedReceipts: number;
    missingEvidence: number;
    taxDocumentsReceived: number;
    taxDocumentsRequested: number;
    documentsAwaitingReview: number;
  };
  nextActions: OverviewAction[];
};

const READINESS_LABEL: Record<string, string> = {
  ready: "Ready",
  needs_review: "Needs review",
  missing_evidence: "Missing evidence",
  books_incomplete: "Books incomplete",
};

const TAX_READINESS_LABEL: Record<string, string> = {
  not_started: "Not started",
  collecting_documents: "Collecting documents",
  bookkeeping_incomplete: "Bookkeeping incomplete",
  professional_review: "Professional review",
  ready_for_preparation: "Ready for preparation",
  preparation_started: "Preparation started",
  complete: "Complete",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
      <div className="text-lg font-semibold tabular-nums" style={tone === "warn" ? { color: "var(--color-warning)" } : undefined}>
        {value}
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
    </div>
  );
}

type TimelineEvent = { id: string; action: string; summary: string; actorUserId: string | null; createdAt: string };
type AgentTask = {
  id: string;
  agent_name: string;
  action_type: string;
  autonomy: "autonomous" | "approval_required";
  status: string;
  confidence: number | null;
  recommendation_json: Record<string, unknown>;
  created_at: string;
};

export function ClientOverview({ clientId, onNavigate }: { clientId: string; onNavigate: (deepLink: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<ReportingPeriodPreset>("current_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categorizeDrafts, setCategorizeDrafts] = useState<Record<string, string>>({});
  const [categorizingId, setCategorizingId] = useState<string | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);

  const { startDate, endDate } = useMemo(() => {
    if (preset === "custom") return { startDate: customStart, endDate: customEnd };
    return presetRange(preset, overview?.header.taxYear ?? null);
  }, [preset, customStart, customEnd, overview?.header.taxYear]);

  useEffect(() => {
    setError(null);
    const query = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : "";
    api<Overview>(`/api/clients/${clientId}/overview${query}`)
      .then(setOverview)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load client overview"));
    api<{ events: TimelineEvent[] }>(`/api/clients/${clientId}/timeline`)
      .then((data) => setTimeline(data.events))
      .catch(() => setTimeline([]));
  }, [clientId, startDate, endDate]);

  useEffect(() => {
    api<{ categories: CategoryOption[] }>(`/api/clients/${clientId}/categories`)
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]));
  }, [clientId]);

  const refreshAgentTasks = () => api<{ tasks: AgentTask[] }>(`/api/clients/${clientId}/agent-tasks`)
    .then((data) => setAgentTasks(Array.isArray(data?.tasks) ? data.tasks : []))
    .catch(() => setAgentTasks([]));

  useEffect(() => { void refreshAgentTasks(); }, [clientId]);

  /**
   * The narrow, auditable correction path for uncategorized_receipt_evidence
   * actions: resolved inline, right where the action surfaces, rather than
   * sending the professional off to a dead-end warning with no way back.
   */
  async function categorizeReceipt(action: OverviewAction) {
    const categoryId = categorizeDrafts[action.id];
    if (!categoryId) return;
    setCategorizingId(action.id);
    try {
      await api(`/api/clients/${clientId}/receipts/${action.sourceEntityId}/category`, {
        method: "PATCH",
        body: JSON.stringify({ categoryId }),
      });
      const query = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : "";
      const refreshed = await api<Overview>(`/api/clients/${clientId}/overview${query}`);
      setOverview(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to categorize this receipt");
    } finally {
      setCategorizingId(null);
    }
  }

  if (error) return <p className="text-sm text-[var(--color-destructive)]">{error}</p>;
  if (!overview) return <p className="text-sm text-[var(--color-muted-foreground)]">Loading overview...</p>;

  const { header, financialStatus, financialPeriod, documentStatus, nextActions } = overview;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Legal name" value={header.legalName || "Not set"} />
          <Field label="Entity type" value={header.entityType || "Not set"} />
          <Field label="Industry" value={header.industry || "Not set"} />
          <Field label="State" value={header.state || "Not set"} />
          <Field label="Tax year" value={header.taxYear ? String(header.taxYear) : "Not set"} />
          <Field label="Accounting basis" value={header.accountingBasis || "Not set"} />
          <Field label="Reporting currency" value={header.reportingCurrency} />
          <Field label="Bookkeeping readiness" value={READINESS_LABEL[header.bookkeepingReadiness] ?? header.bookkeepingReadiness} />
          <Field label="Tax readiness" value={header.taxReadiness ? TAX_READINESS_LABEL[header.taxReadiness] ?? header.taxReadiness : "Not started"} />
          <Field label="Open actions" value={String(header.openActionCount)} />
          <Field label="Last activity" value={header.lastActivityAt ? new Date(header.lastActivityAt).toLocaleDateString() : "No activity yet"} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Financial status</h3>
              <div className="flex items-center gap-2">
                <select
                  className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as ReportingPeriodPreset)}
                >
                  {REPORTING_PERIOD_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {preset === "custom" ? (
                  <>
                    <input type="date" className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                    <input type="date" className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                  </>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]" data-testid="reporting-period-dates">
              Reporting {financialStatus.periodStart} to {financialStatus.periodEnd}
            </p>
            {financialPeriod.unsupported ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{financialPeriod.warning}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric label="Income" value={financialPeriod.income.toFixed(2)} />
                <Metric label="Expenses" value={financialPeriod.expenses.toFixed(2)} />
                <Metric label="Net" value={financialPeriod.net.toFixed(2)} />
                <Metric label="Bank transactions" value={financialStatus.bankTransactionCount} />
                <Metric label="Resolved" value={financialStatus.resolvedCount} />
                <Metric label="Missing evidence" value={financialStatus.missingEvidenceCount} tone={financialStatus.missingEvidenceCount > 0 ? "warn" : undefined} />
                <Metric label="Unclassified" value={financialStatus.unclassifiedCount} tone={financialStatus.unclassifiedCount > 0 ? "warn" : undefined} />
                <Metric label="Uncategorized" value={financialStatus.uncategorizedCount} />
                <Metric label="Currency conflicts" value={financialStatus.currencyConflictCount} tone={financialStatus.currencyConflictCount > 0 ? "warn" : undefined} />
                <Metric label="P&L complete" value={financialStatus.pnlCompleteness ? "Yes" : "No"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">Document status</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Receipts received" value={documentStatus.receiptsReceived} />
              <Metric label="Awaiting review" value={documentStatus.receiptsAwaitingReview} tone={documentStatus.receiptsAwaitingReview > 0 ? "warn" : undefined} />
              <Metric label="Filed receipts" value={documentStatus.filedReceipts} />
              <Metric label="Tax docs received" value={documentStatus.taxDocumentsReceived} />
              <Metric label="Tax docs requested" value={documentStatus.taxDocumentsRequested} tone={documentStatus.taxDocumentsRequested > 0 ? "warn" : undefined} />
              <Metric label="Docs awaiting review" value={documentStatus.documentsAwaitingReview} tone={documentStatus.documentsAwaitingReview > 0 ? "warn" : undefined} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Agent activity</h3>
              <p className="text-xs text-[var(--color-muted-foreground)]">Event-triggered work completed by Folio, plus recommendations requiring your review.</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{agentTasks.filter((task) => task.status === "awaiting_approval").length} to review</Badge>
              <Button size="sm" variant="secondary" onClick={() => onNavigate("?tab=agent")}>View all</Button>
            </div>
          </div>
          {agentTasks.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No agent work has been triggered for this client yet.</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {agentTasks.slice(0, 5).map((task) => {
                const recommendation = Object.entries(task.recommendation_json ?? {}).filter(([key]) => key !== "reason").map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${String(value)}`).join(" · ");
                const waiting = task.status === "awaiting_approval";
                return <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><Badge>{task.agent_name.replace(/_/g, " ")}</Badge><span className="font-medium">{task.action_type.replace(/_/g, " ")}</span></div>
                    <p className="mt-1 truncate text-xs text-[var(--color-muted-foreground)]">{recommendation || "No additional recommendation."}{task.confidence !== null ? ` · ${Math.round(task.confidence * 100)}% confidence` : ""}</p>
                  </div>
                  {waiting ? <span className="text-xs text-amber-600 font-medium">Awaiting review</span> : <span className="text-xs text-[var(--color-muted-foreground)]">{task.status.replace(/_/g, " ")}</span>}
                </div>;
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">Recent activity</h3>
          {timeline.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No activity recorded yet.</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {timeline.slice(0, 10).map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span>{event.summary}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">{new Date(event.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">Next actions</h3>
          {nextActions.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing outstanding" description="No open actions for this client right now." />
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {nextActions.map((action) =>
                action.type === "uncategorized_receipt_evidence" ? (
                  <div key={action.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge>{action.type.replace(/_/g, " ")}</Badge>
                      {action.explanation}
                    </span>
                    <span className="flex items-center gap-2">
                      <select
                        className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                        value={categorizeDrafts[action.id] ?? ""}
                        onChange={(e) => setCategorizeDrafts((prev) => ({ ...prev, [action.id]: e.target.value }))}
                      >
                        <option value="">Set category...</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={categorizingId === action.id || !categorizeDrafts[action.id]}
                        onClick={() => void categorizeReceipt(action)}
                      >
                        Save
                      </Button>
                    </span>
                  </div>
                ) : (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onNavigate(action.deepLink)}
                    className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-[var(--color-foreground)]"
                  >
                    <span className="flex items-center gap-2">
                      <Badge>{action.type.replace(/_/g, " ")}</Badge>
                      {action.explanation}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                  </button>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
