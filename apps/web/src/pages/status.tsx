import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleHelp, Clock3, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

type ComponentStatus = "operational" | "degraded" | "unknown";
type StatusPayload = {
  status: ComponentStatus;
  checkedAt: string | null;
  components: Array<{ name: string; status: ComponentStatus }>;
  supportTarget: string;
};

const statusCopy: Record<ComponentStatus, { title: string; detail: string; icon: typeof CheckCircle2; tone: string }> = {
  operational: { title: "All monitored services are operational", detail: "The latest scheduled check completed successfully.", icon: CheckCircle2, tone: "text-emerald-700 dark:text-emerald-400" },
  degraded: { title: "Some services are degraded", detail: "We are investigating the latest scheduled check result.", icon: TriangleAlert, tone: "text-amber-700 dark:text-amber-400" },
  unknown: { title: "Current status is unavailable", detail: "A recent scheduled check is not available, so we will not claim the service is operating normally.", icon: CircleHelp, tone: "text-slate-700 dark:text-slate-300" },
};

function formatCheckedAt(value: string | null) {
  if (!value) return "No completed check has been recorded yet.";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void fetch("/api/status", { headers: { Accept: "application/json" } })
      .then(async (res) => { if (!res.ok) throw new Error("Status unavailable"); return res.json() as Promise<StatusPayload>; })
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const current = failed ? "unknown" : data?.status ?? "unknown";
  const copy = statusCopy[current];
  const Icon = copy.icon;
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 text-[var(--color-foreground)] sm:px-8 sm:py-16">
      <header className="border-b border-[var(--color-border)] pb-7">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight hover:underline">
          <BrandMark className="h-7 w-7" /> Truepost
        </Link>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">Service status</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">System availability</h1>
      </header>

      <section aria-live="polite" aria-labelledby="current-status" className="border-b border-[var(--color-border)] py-8">
        <div className="flex gap-3">
          <Icon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${copy.tone}`} />
          <div>
            <h2 id="current-status" className="text-lg font-semibold">{copy.title}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{copy.detail}</p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" />Last scheduled check: {formatCheckedAt(data?.checkedAt ?? null)}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="components-heading" className="py-8">
        <h2 id="components-heading" className="text-sm font-semibold">Monitored components</h2>
        <ul className="mt-3 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {(data?.components ?? [{ name: "Application database", status: "unknown" }, { name: "Sign-in service", status: "unknown" }]).map((component) => (
            <li key={component.name} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span>{component.name}</span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusCopy[component.status].tone}`}><span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />{component.status === "operational" ? "Operational" : component.status === "degraded" ? "Degraded" : "Unknown"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-5 text-[var(--color-muted-foreground)]">Status is based on scheduled live database and sign-in checks. An old or missing check is shown as unknown, not healthy.</p>
      </section>

      <section aria-labelledby="support-heading" className="border-t border-[var(--color-border)] py-8">
        <h2 id="support-heading" className="text-sm font-semibold">Support response target</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">{data?.supportTarget ?? "First human response by the end of the same business day."} Automated acknowledgements do not count toward this target.</p>
      </section>
    </main>
  );
}
