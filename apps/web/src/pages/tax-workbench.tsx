import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";

type ClientRow = {
  id: string;
  name: string;
  status: string;
  updatedAt: string | null;
  taxPrepRequired: boolean;
  checklistTotal: number;
  checklistOutstanding: number;
};

type Diagnostic = { code: string; severity: "error" | "warning"; message: string };

type Workbench = {
  client: { id: string; name: string };
  taxYear: number;
  status: string;
  readyForPreparationBlockers: string[];
  diagnostics: Diagnostic[];
  bookkeeping: {
    readiness: string;
    receiptReviewCount: number;
    missingEvidenceCount: number;
    unresolvedBankExceptionCount: number;
    unclassifiedCount: number;
    uncategorizedCount: number;
    currencyConflictCount: number;
  };
  checklist: { total: number; outstanding: number };
  sources: { workpaper: boolean; m1Status: string | null; mappingCount: number };
};

const STATES = [
  "not_started",
  "collecting_documents",
  "bookkeeping_incomplete",
  "professional_review",
  "ready_for_preparation",
  "preparation_started",
  "complete",
];

const BLOCKER_LABELS: Record<string, { label: string; tab: string }> = {
  bookkeeping_incomplete: { label: "Bookkeeping not complete", tab: "overview" },
  tax_diagnostics_errors: { label: "Tax diagnostics have errors", tab: "workpaper" },
  checklist_items_outstanding: { label: "Checklist documents still outstanding", tab: "tax-readiness" },
};

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function clientTab(clientId: string, tab: string, taxYear: number): string {
  return `/clients/${clientId}?tab=${tab}&taxYear=${taxYear}`;
}

const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];

export function TaxWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const taxYear = Number(searchParams.get("year")) || THIS_YEAR - 1;
  const selectedId = searchParams.get("client");
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadList() {
    try {
      const data = await api<{ clients: ClientRow[] }>(`/api/workbench/${taxYear}`);
      setClients(data.clients);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the workbench");
    }
  }

  useEffect(() => {
    setClients(null);
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxYear]);

  function update(next: { year?: number; client?: string | null }) {
    const params = new URLSearchParams(searchParams);
    if (next.year !== undefined) params.set("year", String(next.year));
    if (next.client !== undefined) {
      if (next.client) params.set("client", next.client);
      else params.delete("client");
    }
    setSearchParams(params, { replace: true });
  }

  const counts = new Map<string, number>();
  for (const c of clients ?? []) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
  const visible = (clients ?? []).filter((c) => !stateFilter || c.status === stateFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tax workbench</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">Preparation status for every client, one tax year at a time.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Tax year
          <select
            className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
            value={taxYear}
            onChange={(e) => update({ year: Number(e.target.value), client: null })}
          >
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStateFilter(null)}
          className={`rounded-md border px-3 py-1.5 text-center text-sm ${stateFilter === null ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border)]"}`}
        >
          All {clients?.length ?? 0}
        </button>
        {STATES.map((s) => (
          <button
            key={s}
            onClick={() => setStateFilter(stateFilter === s ? null : s)}
            className={`rounded-md border px-3 py-1.5 text-center text-sm ${stateFilter === s ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border)]"}`}
          >
            {label(s)} {counts.get(s) ?? 0}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          {clients === null ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Loading clients...</p>
          ) : visible.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">No clients in this view.</CardContent></Card>
          ) : (
            <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
              {visible.map((c) => (
                <button
                  key={c.id}
                  onClick={() => update({ client: c.id })}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-[var(--color-muted)] ${selectedId === c.id ? "bg-[var(--color-muted)]" : ""}`}
                >
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {c.checklistTotal === 0 ? "No checklist" : `Checklist ${c.checklistTotal - c.checklistOutstanding} of ${c.checklistTotal} in`}
                      {c.updatedAt ? ` · Status set ${formatDate(c.updatedAt)}` : ""}
                    </p>
                  </div>
                  <Badge>{label(c.status)}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {selectedId ? (
            <ClientWorkbench key={`${selectedId}-${taxYear}`} clientId={selectedId} taxYear={taxYear} onStatusChanged={loadList} />
          ) : (
            <Card><CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">Pick a client to see what blocks preparation.</CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ text, value, to, warn }: { text: string; value: string | number; to: string; warn?: boolean }) {
  return (
    <Link to={to} className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-muted)]">
      <span>{text}</span>
      <span className={warn ? "font-semibold text-[var(--color-warning)] dark:text-amber-400" : "text-[var(--color-muted-foreground)]"}>{value}</span>
    </Link>
  );
}

function ClientWorkbench({ clientId, taxYear, onStatusChanged }: { clientId: string; taxYear: number; onStatusChanged: () => void }) {
  const [wb, setWb] = useState<Workbench | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setWb(await api<Workbench>(`/api/clients/${clientId}/workbench/${taxYear}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load this client");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(status: string) {
    setSaving(true);
    setSaveError(null);
    try {
      await api(`/api/clients/${clientId}/tax-readiness/${taxYear}`, { method: "PUT", body: JSON.stringify({ status }) });
      onStatusChanged();
    } catch (e) {
      setSaveError(`${e instanceof Error ? e.message : "Failed to update."} Resolve the blockers below first.`);
    } finally {
      setSaving(false);
      await load();
    }
  }

  if (error) return <p className="text-sm text-[var(--color-destructive)]">{error}</p>;
  if (!wb) return <p className="text-sm text-[var(--color-muted-foreground)]">Loading...</p>;

  const blocked = wb.readyForPreparationBlockers.length > 0;
  const b = wb.bookkeeping;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">{wb.client.name}</h2>
            <p className="text-xs text-[var(--color-muted-foreground)]">Tax year {wb.taxYear}</p>
          </div>
          <Link to={clientTab(clientId, "overview", taxYear)} className="text-sm text-[var(--color-primary)] hover:underline">Open client</Link>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
              value={wb.status}
              disabled={saving}
              onChange={(e) => void setStatus(e.target.value)}
              aria-label="Preparation status"
            >
              {STATES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <span className={`text-sm font-medium ${blocked ? "text-[var(--color-destructive)]" : "text-[var(--color-success)] dark:text-emerald-400"}`}>
              {blocked ? "Ready for preparation: blocked" : "Ready for preparation: clear"}
            </span>
          </div>
          {saveError ? <p className="text-sm text-[var(--color-destructive)]">{saveError}</p> : null}
          {blocked ? (
            <ul className="space-y-1 text-sm">
              {wb.readyForPreparationBlockers.map((r) => {
                const info = BLOCKER_LABELS[r] ?? { label: label(r), tab: "overview" };
                return (
                  <li key={r}>
                    <Link to={clientTab(clientId, info.tab, taxYear)} className="text-[var(--color-destructive)] hover:underline">{info.label}</Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Tax diagnostics</h3>
          {wb.diagnostics.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">None.</p>
          ) : (
            <ul className="space-y-1">
              {wb.diagnostics.map((d) => (
                <li key={d.code} className="flex items-start gap-2 text-sm">
                  <Badge className={d.severity === "error" ? "bg-[var(--color-destructive)] text-white" : "bg-[var(--color-warning)] text-white"}>{d.severity === "error" ? "Error" : "Warning"}</Badge>
                  <Link to={clientTab(clientId, "workpaper", taxYear)} className="hover:underline">{d.message}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Bookkeeping: {label(b.readiness).toLowerCase()}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Row text="Receipts to review" value={b.receiptReviewCount} warn={b.receiptReviewCount > 0} to={clientTab(clientId, "review", taxYear)} />
            <Row text="Bank exceptions" value={b.unresolvedBankExceptionCount} warn={b.unresolvedBankExceptionCount > 0} to={clientTab(clientId, "bank", taxYear)} />
            <Row text="Missing receipts" value={b.missingEvidenceCount} warn={b.missingEvidenceCount > 0} to={clientTab(clientId, "bank", taxYear)} />
            <Row text="Unclassified transactions" value={b.unclassifiedCount} warn={b.unclassifiedCount > 0} to={clientTab(clientId, "bank", taxYear)} />
            <Row text="Uncategorized receipts" value={b.uncategorizedCount} warn={b.uncategorizedCount > 0} to={clientTab(clientId, "folders", taxYear)} />
            <Row text="Currency conflicts" value={b.currencyConflictCount} warn={b.currencyConflictCount > 0} to={clientTab(clientId, "review", taxYear)} />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Documents and workpapers</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Row text={`Checklist outstanding (of ${wb.checklist.total})`} value={wb.checklist.outstanding} warn={wb.checklist.outstanding > 0} to={clientTab(clientId, "tax-readiness", taxYear)} />
            <Row text="Form mappings" value={wb.sources.mappingCount} warn={wb.sources.mappingCount === 0} to={clientTab(clientId, "workpaper", taxYear)} />
            <Row text="Workpaper" value={wb.sources.workpaper ? "Started" : "None"} to={clientTab(clientId, "workpaper", taxYear)} />
            <Row text="M-1 reconciliation" value={wb.sources.m1Status ? label(wb.sources.m1Status) : "None"} to={clientTab(clientId, "workpaper", taxYear)} />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
