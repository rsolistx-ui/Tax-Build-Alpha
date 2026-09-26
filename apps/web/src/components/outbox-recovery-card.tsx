import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type DeadLetter = {
  id: string;
  operation_kind: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
};

/** Owner-only recovery surface for notifications that exhausted their retries. */
export function OutboxRecoveryCard() {
  const [operations, setOperations] = useState<DeadLetter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api<{ operations: DeadLetter[] }>("/api/admin/outbox?status=dead_letter");
      setOperations(result.operations);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load delivery failures.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function retry(id: string) {
    setRetryingId(id);
    setError(null);
    try {
      await api(`/api/admin/outbox/${id}/retry`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not replay the delivery.");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Card className={operations?.length ? "border-red-500/50" : "border-[var(--color-border)]"}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Delivery recovery</CardTitle>
            <CardDescription className="mt-1 text-xs">Only notifications that exhausted automatic retries appear here. Replay preserves the provider idempotency key.</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <p role="alert" className="mb-3 rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-800 dark:text-red-200">{error}</p> : null}
        {operations === null ? <p className="text-sm text-[var(--color-muted-foreground)]">Loading delivery status…</p> : null}
        {operations?.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No dead-lettered deliveries. Automatic recovery is clear.</p> : null}
        {operations?.length ? (
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {operations.map((operation) => (
              <li key={operation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-medium">{operation.operation_kind}</p>
                  <p className="mt-1 truncate text-xs text-[var(--color-muted-foreground)]" title={operation.last_error ?? undefined}>{operation.last_error || "Provider did not return a reason."}</p>
                  <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">{operation.attempt_count} attempts · queued {new Date(operation.created_at).toLocaleString()}</p>
                </div>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void retry(operation.id)} disabled={retryingId === operation.id}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {retryingId === operation.id ? "Replaying…" : "Replay"}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
