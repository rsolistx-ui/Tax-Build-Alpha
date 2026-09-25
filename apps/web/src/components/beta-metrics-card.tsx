import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Metric = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  sample: number;
  target: string | null;
  status: "meets" | "misses" | "collecting" | "no_target";
  detail: string[];
};

const STATUS: Record<Metric["status"], { label: string; className: string }> = {
  meets: { label: "Meets target", className: "bg-emerald-600 text-white" },
  misses: { label: "Misses target", className: "bg-red-600 text-white" },
  collecting: { label: "Collecting data", className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" },
  no_target: { label: "No pass line yet", className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" },
};

/** The gap analysis beta metrics, across every firm. Status is shown only when a target and enough data exist. */
export function BetaMetricsCard() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMetrics(null);
    setError(null);
    void api<{ metrics: Metric[] }>(`/api/admin/beta-metrics?days=${days}`)
      .then((r) => setMetrics(r.metrics))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load beta metrics."));
  }, [days]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Beta metrics</CardTitle>
          <select
            aria-label="Period"
            className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
        <CardDescription className="text-xs">All firms. The numbers that make the product claims provable.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <p className="rounded-md bg-red-500/15 px-3 py-2 text-sm">{error}</p> : null}
        {!metrics && !error ? <p className="text-sm text-[var(--color-muted-foreground)]">Loading...</p> : null}
        {metrics ? (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {metrics.map((m) => (
              <li key={m.key} className="space-y-1.5 rounded-lg border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-muted-foreground)]">{m.label}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {m.value === null ? "No data" : m.value.toLocaleString()}
                  {m.value === null ? null : <span className="ml-1 text-sm font-normal text-[var(--color-muted-foreground)]">{m.unit}</span>}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS[m.status].className}`}>{STATUS[m.status].label}</span>
                  <span className="text-[var(--color-muted-foreground)]">sample {m.sample.toLocaleString()}</span>
                </div>
                {m.target ? <p className="text-xs">Target: {m.target}</p> : null}
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--color-muted-foreground)]">
                  {m.detail.map((d) => <li key={d}>{d}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
