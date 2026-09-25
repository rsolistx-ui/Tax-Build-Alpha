import { useCallback, useEffect, useState } from "react";
import { Landmark, Scale, Waves } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Kind = "checking" | "savings" | "credit_card" | "loan";
type Account = { id: string; name: string; kind: Kind; openingBalance: number; chargesPositive: boolean; transactionCount: number };
type ImportBatch = { importBatchId: string | null; filename: string | null; currency: string | null; transactionCount: number; earliestDate: string | null; latestDate: string | null; accountIds: string[] };
type Line = { key: string; label: string; amount: number; count?: number; review?: boolean };
type BalanceSheetResponse = {
  asOf: string;
  currency: string;
  balanceSheet: { assets: Line[]; liabilities: Line[]; equity: Line[]; totals: { assets: number; liabilities: number; equity: number; liabilitiesAndEquity: number; difference: number } };
  warnings: string[];
};
type CashFlowResponse = {
  currency: string;
  cashFlow: { periodStart: string; periodEnd: string; beginningCash: number; operating: Line[]; financing: Line[]; transfers: Line[]; review: Line[]; netChange: number; endingCash: number; difference: number; netIncome: number };
  warnings: string[];
};
type Drill = { title: string; total: number; transactions: Array<{ id: string; date: string; description: string | null; amount: number; disposition: string }> };

const KIND_LABELS: Record<Kind, string> = { checking: "Checking", savings: "Savings", credit_card: "Credit card", loan: "Loan" };
const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

export function FinancialStatementsPanel({ clientId }: { clientId: string }) {
  const base = `/api/clients/${clientId}`;
  const [setup, setSetup] = useState<{ booksStartDate: string | null; accounts: Account[]; importBatches: ImportBatch[] } | null>(null);
  const [booksStart, setBooksStart] = useState("");
  const [newAccount, setNewAccount] = useState({ name: "", kind: "checking" as Kind, openingBalance: "", chargesPositive: false });
  // Opening balances being edited; cleared after each save attempt so the field shows what is actually saved.
  const [openingDrafts, setOpeningDrafts] = useState<Record<string, string>>({});
  const [asOf, setAsOf] = useState(today());
  const [period, setPeriod] = useState({ start: `${new Date().getFullYear()}-01-01`, end: today() });
  const [bs, setBs] = useState<BalanceSheetResponse | null>(null);
  const [cf, setCf] = useState<CashFlowResponse | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSetup = useCallback(async () => {
    const s = await api<{ booksStartDate: string | null; accounts: Account[]; importBatches: ImportBatch[] }>(`${base}/accounts`);
    setSetup(s);
    setBooksStart(s.booksStartDate ?? "");
  }, [base]);
  const loadStatements = useCallback(async () => {
    const [b, c] = await Promise.all([
      api<BalanceSheetResponse>(`${base}/balance-sheet?asOf=${asOf}`),
      api<CashFlowResponse>(`${base}/cash-flow?start=${period.start}&end=${period.end}`),
    ]);
    setBs(b);
    setCf(c);
  }, [base, asOf, period.start, period.end]);

  useEffect(() => {
    void loadSetup().catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load accounts."));
  }, [loadSetup]);
  useEffect(() => {
    if (!asOf || !period.start || !period.end || period.start > period.end) return;
    void loadStatements().catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load statements."));
  }, [loadStatements, asOf, period.start, period.end]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.all([loadSetup(), loadStatements()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function openLine(line: Line, cashOnly: boolean, start?: string, end = asOf) {
    if (!line.count) return;
    const q = new URLSearchParams({ line: line.key, end, cashOnly: String(cashOnly), ...(start ? { start } : {}) });
    const res = await api<Omit<Drill, "title">>(`${base}/statement-lines?${q}`);
    setDrill({ title: line.label, ...res });
  }

  const assignable = (setup?.accounts ?? []).filter((a) => a.kind !== "loan");
  const currency = bs?.currency ?? cf?.currency ?? "USD";

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-md bg-red-500/15 px-3 py-2 text-sm">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" /> Accounts and opening balances</CardTitle>
          <CardDescription>Balances on the books start date. Activity after it builds the statements.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => api(`${base}/accounts/books-start`, { method: "PUT", body: JSON.stringify({ date: booksStart || null }) })); }}>
            <label className="space-y-1">
              <span className="block text-xs text-[var(--color-muted-foreground)]">Books start date</span>
              <Input type="date" value={booksStart} onChange={(e) => setBooksStart(e.target.value)} className="w-44" />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>Save date</Button>
          </form>

          {(setup?.accounts ?? []).length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
              {setup!.accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 font-medium">{a.name}</span>
                  <Badge>{KIND_LABELS[a.kind]}</Badge>
                  <span className="text-xs text-[var(--color-muted-foreground)]">{a.transactionCount} txns</span>
                  <Input
                    type="number" step="0.01" className="w-32" aria-label={`Opening balance for ${a.name}`}
                    value={openingDrafts[a.id] ?? String(a.openingBalance)}
                    onChange={(e) => setOpeningDrafts({ ...openingDrafts, [a.id]: e.target.value })}
                    onBlur={() => {
                      const draft = openingDrafts[a.id];
                      if (draft === undefined) return;
                      const clear = () => setOpeningDrafts((d) => { const { [a.id]: _, ...rest } = d; return rest; });
                      const v = Number(draft);
                      if (draft === "" || !Number.isFinite(v) || v === a.openingBalance) { clear(); return; }
                      void run(() => api(`${base}/accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ openingBalance: v }) })).finally(clear);
                    }}
                  />
                  {a.kind === "credit_card" ? (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox" checked={a.chargesPositive} disabled={busy}
                        onChange={(e) => void run(() => api(`${base}/accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ chargesPositive: e.target.checked }) }))}
                      />
                      Charges show as positive numbers
                    </label>
                  ) : null}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api(`${base}/accounts/${a.id}`, { method: "DELETE" }))}>Remove</Button>
                </li>
              ))}
            </ul>
          ) : null}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`${base}/accounts`, { method: "POST", body: JSON.stringify({ name: newAccount.name, kind: newAccount.kind, openingBalance: Number(newAccount.openingBalance || 0), chargesPositive: newAccount.kind === "credit_card" && newAccount.chargesPositive }) });
                setNewAccount({ name: "", kind: "checking", openingBalance: "", chargesPositive: false });
              });
            }}
          >
            <Input placeholder="Account name" aria-label="New account name" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} className="w-48" />
            <select aria-label="New account type" className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2" value={newAccount.kind} onChange={(e) => setNewAccount({ ...newAccount, kind: e.target.value as Kind })}>
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            <Input type="number" step="0.01" aria-label="New account opening balance" placeholder={newAccount.kind === "checking" || newAccount.kind === "savings" ? "Balance held" : "Amount owed"} value={newAccount.openingBalance} onChange={(e) => setNewAccount({ ...newAccount, openingBalance: e.target.value })} className="w-36" />
            {newAccount.kind === "credit_card" ? (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={newAccount.chargesPositive} onChange={(e) => setNewAccount({ ...newAccount, chargesPositive: e.target.checked })} />
                Charges show as positive numbers (Amex and some others)
              </label>
            ) : null}
            <Button type="submit" disabled={busy || !newAccount.name.trim()}>Add account</Button>
          </form>

          {(setup?.importBatches ?? []).length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">Bank imports</p>
              <ul className="space-y-1">
                {setup!.importBatches.map((b) => (
                  <li key={b.importBatchId ?? "none"} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{b.filename ?? "Earlier activity"} · {b.transactionCount} txns{b.currency ? ` · ${b.currency}` : ""} · {b.earliestDate ?? "?"} to {b.latestDate ?? "?"}</span>
                    <select
                      className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
                      value={b.accountIds.length === 1 ? b.accountIds[0] : b.accountIds.length > 1 ? "__mixed" : ""}
                      disabled={busy || assignable.length === 0}
                      onChange={(e) => void run(() => api(`${base}/accounts/assign-import`, { method: "POST", body: JSON.stringify({ importBatchId: b.importBatchId, accountId: e.target.value || null }) }))}
                      aria-label={`Account for ${b.filename ?? "earlier activity"}`}
                    >
                      <option value="">Not assigned</option>
                      {b.accountIds.length > 1 ? <option value="__mixed" disabled>Several accounts</option> : null}
                      {assignable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4" /> Balance sheet</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              As of <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40" />
              {bs ? (bs.balanceSheet.totals.difference === 0
                ? <Badge className="bg-emerald-600 text-white">Balanced</Badge>
                : <Badge className="bg-red-600 text-white">Off by {money(bs.balanceSheet.totals.difference, currency)}</Badge>) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {bs ? (
              <>
                <Section title="Assets" lines={bs.balanceSheet.assets} total={bs.balanceSheet.totals.assets} currency={currency} onOpen={(l) => void openLine(l, false)} />
                <Section title="Liabilities" lines={bs.balanceSheet.liabilities} total={bs.balanceSheet.totals.liabilities} currency={currency} onOpen={(l) => void openLine(l, false)} />
                <Section title="Equity" lines={bs.balanceSheet.equity} total={bs.balanceSheet.totals.equity} currency={currency} onOpen={(l) => void openLine(l, false)} />
                <Row label="Liabilities and equity" amount={bs.balanceSheet.totals.liabilitiesAndEquity} currency={currency} strong />
                <Warnings items={bs.warnings} />
              </>
            ) : <p className="text-[var(--color-muted-foreground)]">Loading...</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Waves className="h-4 w-4" /> Cash flow</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <Input type="date" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} className="h-8 w-40" aria-label="Period start" />
              to
              <Input type="date" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} className="h-8 w-40" aria-label="Period end" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {cf ? (
              <>
                <Row label={`Cash at ${cf.cashFlow.periodStart}`} amount={cf.cashFlow.beginningCash} currency={currency} strong />
                {[["Operating", cf.cashFlow.operating], ["Owner and loans", cf.cashFlow.financing], ["Transfers", cf.cashFlow.transfers], ["Needs review", cf.cashFlow.review]].map(([title, lines]) =>
                  (lines as Line[]).length > 0 ? <Section key={title as string} title={title as string} lines={lines as Line[]} currency={currency} onOpen={(l) => void openLine(l, true, cf.cashFlow.periodStart, cf.cashFlow.periodEnd)} /> : null)}
                <Row label="Net change in cash" amount={cf.cashFlow.netChange} currency={currency} />
                <Row label={`Cash at ${cf.cashFlow.periodEnd}`} amount={cf.cashFlow.endingCash} currency={currency} strong />
                <Row label="Net income for the period (P&L)" amount={cf.cashFlow.netIncome} currency={currency} />
                {cf.cashFlow.difference !== 0 ? <p className="rounded-md bg-red-500/15 px-3 py-2">Does not tie: off by {money(cf.cashFlow.difference, currency)}</p> : null}
              </>
            ) : <p className="text-[var(--color-muted-foreground)]">Loading...</p>}
          </CardContent>
        </Card>
      </div>

      {drill ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{drill.title}</CardTitle>
            <CardDescription>{drill.total} transaction(s){drill.total > drill.transactions.length ? `, newest ${drill.transactions.length} shown` : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--color-border)] text-sm">
              {drill.transactions.map((t) => (
                <li key={t.id} className="flex gap-3 py-1.5">
                  <span className="w-24 shrink-0 text-[var(--color-muted-foreground)]">{t.date}</span>
                  <span className="min-w-0 flex-1 truncate">{t.description ?? ""}</span>
                  <span className="tabular-nums">{money(t.amount, currency)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Section({ title, lines, total, currency, onOpen }: { title: string; lines: Line[]; total?: number; currency: string; onOpen: (line: Line) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{title}</p>
      {lines.length === 0 ? <p className="text-[var(--color-muted-foreground)]">None</p> : null}
      {lines.map((l) => (
        <button
          key={l.key}
          type="button"
          disabled={!l.count}
          onClick={() => onOpen(l)}
          className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left ${l.review ? "bg-amber-500/15" : ""} ${l.count ? "hover:bg-[var(--color-muted)]" : "cursor-default"}`}
        >
          <span className="min-w-0 flex-1">{l.label}{l.count ? <span className="text-xs text-[var(--color-muted-foreground)]"> · {l.count}</span> : null}</span>
          <span className="tabular-nums">{money(l.amount, currency)}</span>
        </button>
      ))}
      {total !== undefined ? <Row label={`Total ${title.toLowerCase()}`} amount={total} currency={currency} strong /> : null}
    </div>
  );
}

function Row({ label, amount, currency, strong }: { label: string; amount: number; currency: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-2 ${strong ? "border-t border-[var(--color-border)] pt-1 font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{money(amount, currency)}</span>
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--color-muted-foreground)]">
      {items.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
}
