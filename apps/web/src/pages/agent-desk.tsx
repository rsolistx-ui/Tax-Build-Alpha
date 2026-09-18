import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type DeskTask = {
  id: string;
  client_id: string;
  client_name: string;
  agent_name: string;
  action_type: string;
  autonomy: "autonomous" | "approval_required";
  status: string;
  confidence: number | null;
  recommendation_json: Record<string, unknown>;
  created_at: string;
};

function label(value: string): string {
  return value.replace(/_/g, " ");
}

const HIDDEN_RECOMMENDATION_KEYS = new Set(["reason", "gmailMessageId", "gmailThreadId"]);

function recommendationText(task: DeskTask): string {
  return Object.entries(task.recommendation_json ?? {})
    .filter(([key]) => !HIDDEN_RECOMMENDATION_KEYS.has(key))
    .map(([key, value]) => `${label(key)}: ${String(value)}`)
    .join(" · ");
}

export function AgentDeskPage() {
  const [tasks, setTasks] = useState<DeskTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ tasks: DeskTask[] }>("/api/agent-tasks");
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agent recommendations");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(task: DeskTask, action: "approve" | "dismiss") {
    setResolvingId(task.id);
    try {
      await api(`/api/clients/${task.client_id}/agent-tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          note: action === "approve" ? "Professional approved the agent recommendation." : "Professional dismissed the agent recommendation.",
        }),
      });
      setTasks((current) => current.filter((t) => t.id !== task.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update the agent recommendation");
    } finally {
      setResolvingId(null);
    }
  }

  async function scanInbox() {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await api<{ scanned: number; matched: number; tasksCreated: number; unmatchedSenders: string[]; note?: string }>(
        "/api/gmail/triage",
        { method: "POST", body: JSON.stringify({}) },
      );
      setScanResult(
        result.note ?? `Scanned ${result.scanned} recent emails, matched ${result.matched} to clients, ${result.tasksCreated} new follow-up${result.tasksCreated === 1 ? "" : "s"} added below.`,
      );
      await load();
    } catch (e) {
      setScanResult(e instanceof Error ? e.message : "Could not scan the inbox.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Agent desk</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Every agent recommendation awaiting your decision across all clients.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" variant="secondary" disabled={scanning} onClick={() => void scanInbox()}>
            {scanning ? "Scanning…" : "Scan inbox for client emails"}
          </Button>
          {scanResult ? <p className="max-w-xs text-right text-xs text-[var(--color-muted-foreground)]">{scanResult}</p> : null}
        </div>
      </div>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-[var(--color-muted-foreground)]">
            <Sparkles className="h-4 w-4" />
            No agent recommendations are awaiting approval.
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {tasks.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <Link to={`/clients/${task.client_id}`} className="font-medium hover:text-[var(--color-primary)]">
                  {task.client_name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge>{label(task.agent_name)}</Badge>
                  <span className="text-sm">{label(task.action_type)}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  {recommendationText(task) || "No additional recommendation."}
                  {task.confidence !== null ? ` · ${Math.round(task.confidence * 100)}% confidence` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-[var(--color-muted-foreground)]">{new Date(task.created_at).toLocaleDateString()}</span>
                <Button size="sm" variant="secondary" disabled={resolvingId === task.id} onClick={() => void review(task, "dismiss")}>
                  Dismiss
                </Button>
                <Button size="sm" disabled={resolvingId === task.id} onClick={() => void review(task, "approve")}>
                  Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}