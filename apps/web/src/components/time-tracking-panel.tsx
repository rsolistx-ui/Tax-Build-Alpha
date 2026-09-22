import { useState, useEffect, useCallback, useRef } from "react";
import { Timer, Play, Square, Loader2, ReceiptText } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BillingRate {
  id: string;
  name: string;
  rateType: "hourly" | "fixed" | "retainer";
  rate: number;
}

interface TimeEntry {
  id: string;
  description: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  billingRateId: string | null;
  invoiceId: string | null;
}

function formatElapsed(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function TimeTrackingPanel({ clientId, onInvoiced }: { clientId: string; onInvoiced?: () => void }) {
  const [rates, setRates] = useState<BillingRate[]>([]);
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [unbilled, setUnbilled] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selectedRateId, setSelectedRateId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  const [showRateForm, setShowRateForm] = useState(false);
  const [rateName, setRateName] = useState("Standard hourly");
  const [rateValue, setRateValue] = useState(150);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ratesRes, runningRes, unbilledRes] = await Promise.all([
        api<{ rates: BillingRate[] }>(`/api/billing/billing-rates?clientId=${clientId}`),
        api<{ entry: TimeEntry | null }>(`/api/time-entries/${clientId}/timer/running`),
        api<{ entries: TimeEntry[] }>(`/api/time-entries/${clientId}/entries?unbilled=1`),
      ]);
      setRates(ratesRes.rates || []);
      setRunning(runningRes.entry);
      setUnbilled(unbilledRes.entries || []);
      setSelectedRateId((prev) => prev || ratesRes.rates?.[0]?.id || "");
    } catch (err: any) {
      setError(err?.message || "Failed to load time tracking data.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!running) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [running]);

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/time-entries/${clientId}/timer/start`, {
        method: "POST",
        body: JSON.stringify({
          description: description || "Untitled work",
          billingRateId: selectedRateId || undefined,
        }),
      });
      setDescription("");
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to start timer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!running) return;
    setBusy(true);
    try {
      await api(`/api/time-entries/${clientId}/timer/${running.id}/stop`, { method: "POST" });
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to stop timer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/billing/billing-rates`, {
        method: "POST",
        body: JSON.stringify({
          clientId,
          name: rateName,
          rateType: "hourly",
          rate: Number(rateValue),
          effectiveFrom: new Date().toISOString().slice(0, 10),
        }),
      });
      setShowRateForm(false);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to create billing rate.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleConvertToInvoice() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 15);
      await api(`/api/time-entries/${clientId}/entries/convert-to-invoice`, {
        method: "POST",
        body: JSON.stringify({
          entryIds: [...selected],
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: dueDate.toISOString().slice(0, 10),
        }),
      });
      setSelected(new Set());
      await load();
      onInvoiced?.();
    } catch (err: any) {
      setError(err?.message || "Failed to convert time entries into an invoice. Entries without a billing rate must have one assigned first.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-foreground)] flex items-center gap-1.5">
            <Timer className="h-4 w-4" /> Time Tracking
          </h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Log billable work here, then turn unbilled entries into an invoice in one action.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">{error}</div>
      ) : null}

      {rates.length === 0 && !showRateForm ? (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              No billing rate is set for this client yet. Set one to bill logged time.
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowRateForm(true)}>
              Set hourly rate
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showRateForm ? (
        <Card className="border-[var(--color-border)]">
          <CardContent className="p-4">
            <form onSubmit={handleCreateRate} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <Label className="text-xs">Rate name</Label>
                <Input className="h-8 text-xs" value={rateName} onChange={(e) => setRateName(e.target.value)} />
              </div>
              <div className="w-28">
                <Label className="text-xs">$ / hour</Label>
                <Input className="h-8 text-xs" type="number" min={0} step="0.01" value={rateValue}
                  onChange={(e) => setRateValue(Number(e.target.value))} />
              </div>
              <Button size="sm" type="submit" disabled={busy} className="h-8 text-xs">Save rate</Button>
              <Button size="sm" type="button" variant="ghost" className="h-8 text-xs" onClick={() => setShowRateForm(false)}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-[var(--color-border)]">
        <CardContent className="p-4">
          {running ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[var(--color-muted-foreground)]">{running.description}</div>
                <div className="text-2xl font-bold tabular-nums text-[var(--color-foreground)]">{formatElapsed(running.startedAt)}</div>
              </div>
              <Button size="sm" variant="destructive" className="h-8 text-xs gap-1.5" disabled={busy} onClick={handleStop}>
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs">What are you working on?</Label>
                <Input className="h-8 text-xs" placeholder="e.g. Bank reconciliation" value={description}
                  onChange={(e) => setDescription(e.target.value)} />
              </div>
              {rates.length > 0 ? (
                <div className="w-44">
                  <Label className="text-xs">Bill at</Label>
                  <select
                    className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs text-[var(--color-foreground)]"
                    value={selectedRateId}
                    onChange={(e) => setSelectedRateId(e.target.value)}
                  >
                    {rates.map((r) => (
                      <option key={r.id} value={r.id}>{r.name} (${r.rate}/{r.rateType === "hourly" ? "hr" : r.rateType})</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button size="sm" className="h-8 text-xs gap-1.5" disabled={busy} onClick={handleStart}>
                <Play className="h-3.5 w-3.5" /> Start timer
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {unbilled.length > 0 ? (
        <Card className="border-[var(--color-border)]">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-foreground)]">Unbilled time ({unbilled.length})</span>
              <Button size="sm" className="h-7 text-xs gap-1.5" disabled={busy || selected.size === 0} onClick={handleConvertToInvoice}>
                <ReceiptText className="h-3.5 w-3.5" /> Convert {selected.size > 0 ? `${selected.size} ` : ""}to invoice
              </Button>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {unbilled.map((entry) => (
                <label key={entry.id} className="flex items-center gap-3 py-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelected(entry.id)} />
                  <span className="flex-1 text-[var(--color-foreground)]">{entry.description}</span>
                  {!entry.billingRateId ? (
                    <span className="text-amber-600 text-[10px]">no rate assigned</span>
                  ) : null}
                  <span className="text-[var(--color-muted-foreground)] tabular-nums">{formatDuration(entry.durationMinutes)}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
