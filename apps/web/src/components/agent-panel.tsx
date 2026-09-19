import { useCallback, useEffect, useState } from "react";
import { Bot, Brain, CheckCircle2, Clock, Filter, Sparkles, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatLegibleMessage } from "@/lib/formatters";

type AgentTask = {
  id: string;
  client_id: string;
  source_type: string;
  source_id: string;
  agent_name: string;
  action_type: string;
  autonomy: "autonomous" | "approval_required";
  status: string;
  confidence: number | null;
  recommendation_json: Record<string, unknown>;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

type CorrectionRule = {
  id: string;
  rule_type: string;
  match_key: string;
  output_json: Record<string, unknown>;
  seen_count: number;
  last_applied_at: string | null;
  created_at: string;
};

type StatusFilter = "all" | "awaiting_approval" | "approved" | "dismissed" | "completed";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting_approval", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "completed", label: "Autonomous" },
];

function label(value: string): string {
  return value.replace(/_/g, " ");
}

function recommendationText(task: AgentTask): string {
  return Object.entries(task.recommendation_json ?? {})
    .filter(([key]) => key !== "reason")
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${String(value)}`)
    .join(" · ");
}

function StatusIcon({ status }: { status: string }) {
  if (status === "approved" || status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "dismissed") return <XCircle className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />;
  if (status === "awaiting_approval") return <Clock className="h-3.5 w-3.5 text-amber-500" />;
  return <Sparkles className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />;
}

export function AgentPanel({ clientId }: { clientId: string }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [rules, setRules] = useState<CorrectionRule[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [taskData, ruleData] = await Promise.all([
        api<{ tasks: AgentTask[] }>(`/api/clients/${clientId}/agent-tasks`),
        api<{ rules: CorrectionRule[] }>(`/api/clients/${clientId}/correction-rules`).catch(() => ({ rules: [] })),
      ]);
      setTasks(Array.isArray(taskData.tasks) ? taskData.tasks : []);
      setRules(Array.isArray(ruleData.rules) ? ruleData.rules : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agent data");
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  async function review(task: AgentTask, action: "approve" | "dismiss") {
    setResolvingId(task.id);
    try {
      await api(`/api/clients/${clientId}/agent-tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          note: action === "approve" ? "Professional approved the agent recommendation." : "Professional dismissed the agent recommendation.",
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update the agent recommendation");
    } finally {
      setResolvingId(null);
    }
  }

  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const awaitingCount = tasks.filter((t) => t.status === "awaiting_approval").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const approvedCount = tasks.filter((t) => t.status === "approved").length;

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold">Agent task history</h3>
          <div className="flex items-center gap-1.5">
            {awaitingCount > 0 ? <Badge className="bg-amber-100 text-amber-800">{awaitingCount} awaiting</Badge> : null}
            {approvedCount > 0 ? <Badge className="bg-emerald-100 text-emerald-800">{approvedCount} approved</Badge> : null}
            {completedCount > 0 ? <Badge className="bg-stone-200 text-stone-700">{completedCount} autonomous</Badge> : null}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
          <Filter className="h-3 w-3 ml-1.5 text-[var(--color-muted-foreground)]" />
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={cn(
                "rounded px-2 py-1 text-xs",
                filter === opt.value && "bg-[var(--color-muted)] font-medium",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-[var(--color-muted-foreground)]">
            <Bot className="h-4 w-4" />
            No agent work has been triggered for this client yet.
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
            No tasks match this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {filtered.map((task) => {
            const recommendation = recommendationText(task);
            const reason = (task.recommendation_json?.reason as string | undefined) ?? null;
            const waiting = task.status === "awaiting_approval";
            return (
              <div key={task.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusIcon status={task.status} />
                    <Badge>{label(task.agent_name)}</Badge>
                    <span className="text-sm font-medium">{label(task.action_type)}</span>
                    <span className="text-xs text-[var(--color-muted-foreground)]">{label(task.source_type)}</span>
                  </div>
                  {recommendation ? (
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      {recommendation}
                      {task.confidence !== null ? ` · ${Math.round(task.confidence * 100)}% confidence` : ""}
                    </p>
                  ) : null}
                  {reason ? (
                    <p className="mt-0.5 text-xs italic text-[var(--color-muted-foreground)]">{formatLegibleMessage(reason)}</p>
                  ) : null}
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-[var(--color-muted-foreground)]">
                    <span>{formatDateTime(task.created_at)}</span>
                    {task.resolved_at ? <span>Resolved {formatDateTime(task.resolved_at)}</span> : null}
                    {task.resolution_note ? <span className="truncate max-w-[200px]">"{formatLegibleMessage(task.resolution_note)}"</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {waiting ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={resolvingId === task.id} onClick={() => void review(task, "dismiss")}>
                        Dismiss
                      </Button>
                      <Button size="sm" disabled={resolvingId === task.id} onClick={() => void review(task, "approve")}>
                        Approve
                      </Button>
                    </>
                  ) : (
                    <Badge className={cn(
                      task.status === "approved" || task.status === "completed" ? "bg-emerald-100 text-emerald-800" :
                      task.status === "dismissed" ? "bg-stone-200 text-stone-600" :
                      "bg-stone-200 text-stone-700",
                    )}>
                      {label(task.status)}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <h3 className="text-sm font-semibold">Merchant memory</h3>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Folio remembers category corrections per merchant. When you approve a categorization or edit a receipt review, the rule is stored here and automatically applied to future receipts from the same merchant.
          </p>
          {rules.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No merchant rules remembered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    <th className="pb-2 pr-3">Merchant</th>
                    <th className="pb-2 pr-3">Category</th>
                    <th className="pb-2 pr-3">Times applied</th>
                    <th className="pb-2">Last applied</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="py-2 pr-3 font-medium">{rule.match_key}</td>
                      <td className="py-2 pr-3">
                        <Badge>{(rule.output_json?.category as string) ?? "Unknown"}</Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{rule.seen_count}</td>
                      <td className="py-2 text-xs text-[var(--color-muted-foreground)]">
                        {rule.last_applied_at ? formatDate(rule.last_applied_at) : "—"}
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
  );
}
