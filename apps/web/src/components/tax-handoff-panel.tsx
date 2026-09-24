import { useEffect, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type LineOption = { code: string; line: string; label: string; kind: "income" | "cogs" | "expense" };
type HandoffLine = LineOption & { amount: number; categories: string[]; note: string | null };
type HandoffCategory = {
  categoryId: string | null;
  category: string;
  side: "income" | "expense";
  total: number;
  lineCode: string | null;
  source: "preparer" | "suggested" | "none";
};
type Handoff = {
  taxYear: number;
  booksComplete: boolean;
  completeness: { unclassifiedCount: number; unresolvedTriageCount: number; uncategorizedCount: number; currencyConflictCount: number };
  lines: HandoffLine[];
  totals: { grossIncome: number; totalExpenses: number; tentativeProfit: number };
  categories: HandoffCategory[];
  needsLine: HandoffCategory[];
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Schedule C line totals from the client's books for one tax year, for the
 * preparer to key into the tax software they file with. Every category shows
 * the line it lands on; the preparer can change any of them.
 */
export function TaxHandoffPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [options, setOptions] = useState<LineOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await api<{ handoff: Handoff; lineOptions: LineOption[] }>(`/api/clients/${clientId}/tax-handoff/${taxYear}`);
      setHandoff(res.handoff);
      setOptions(res.lineOptions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the Schedule C handoff.");
    }
  }

  useEffect(() => {
    setHandoff(null);
    void load();
  }, [clientId, taxYear]);

  async function setLine(categoryId: string, lineCode: string | null) {
    setSavingId(categoryId);
    setError(null);
    try {
      await api(`/api/clients/${clientId}/tax-handoff/${taxYear}/lines`, { method: "PUT", body: JSON.stringify({ categoryId, lineCode }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that line.");
    } finally {
      setSavingId(null);
    }
  }

  async function copyLines() {
    if (!handoff) return;
    const text = handoff.lines
      .filter((l) => l.amount !== 0)
      .map((l) => `Line ${l.line}\t${l.label}\t${l.amount.toFixed(2)}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error && !handoff) {
    return <Card><CardContent className="p-4 text-sm text-[var(--color-destructive)]">{error}</CardContent></Card>;
  }
  if (!handoff) {
    return <Card><CardContent className="p-4 text-sm text-[var(--color-muted-foreground)]">Loading Schedule C handoff...</CardContent></Card>;
  }

  const c = handoff.completeness;
  const openBookItems = c.unclassifiedCount + c.unresolvedTriageCount + c.uncategorizedCount + c.currencyConflictCount;
  const isDraft = !handoff.booksComplete || handoff.needsLine.length > 0;
  const shownLines = handoff.lines.filter((l) => l.amount !== 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Schedule C handoff, tax year {handoff.taxYear}</CardTitle>
            <CardDescription>
              Line totals from the books, to key into the tax software you file with. Truepost does not prepare or file the return.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void copyLines()} disabled={shownLines.length === 0}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy lines"}
            </Button>
            <a href={apiUrl(`/api/clients/${clientId}/tax-handoff/${taxYear}/xlsx`)} target="_blank" rel="noreferrer">
              <Button size="sm" className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Download spreadsheet
              </Button>
            </a>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge className={isDraft ? "bg-[var(--color-warning)] text-white" : "bg-[var(--color-success)] text-white"}>
            {isDraft ? "Draft" : "Books complete"}
          </Badge>
          {openBookItems > 0 ? <span>{openBookItems} open item(s) in the books</span> : null}
          {handoff.needsLine.length > 0 ? <span>{handoff.needsLine.length} categor{handoff.needsLine.length === 1 ? "y needs" : "ies need"} a line</span> : null}
        </div>
        {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
              <th className="py-1 font-medium">Line</th>
              <th className="py-1 font-medium">Description</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {shownLines.length === 0 ? (
              <tr><td colSpan={3} className="py-2 text-[var(--color-muted-foreground)]">No categorized amounts for {handoff.taxYear}.</td></tr>
            ) : shownLines.map((l) => (
              <tr key={l.code} className="border-t border-[var(--color-border)] align-top">
                <td className="py-1.5 pr-2 tabular-nums">{l.line}</td>
                <td className="py-1.5">
                  <div>{l.label}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">{l.categories.join(", ")}</div>
                  {l.note ? <div className="text-xs text-[var(--color-muted-foreground)]">{l.note}</div> : null}
                </td>
                <td className="py-1.5 text-right tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-[var(--color-border)] font-semibold">
              <td className="py-1.5">7</td><td className="py-1.5">Gross income</td><td className="py-1.5 text-right tabular-nums">{money(handoff.totals.grossIncome)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-1.5">28</td><td className="py-1.5">Total expenses (before lines 13, 27a and 30)</td><td className="py-1.5 text-right tabular-nums">{money(handoff.totals.totalExpenses)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-1.5">29</td><td className="py-1.5">Tentative profit (before line 30)</td><td className="py-1.5 text-right tabular-nums">{money(handoff.totals.tentativeProfit)}</td>
            </tr>
          </tbody>
        </table>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Category to line</h3>
          <ul className="space-y-1">
            {handoff.categories.map((cat, i) => {
              const choices = options.filter((o) => (cat.side === "income" ? o.kind === "income" : o.kind !== "income"));
              const needs = cat.lineCode === null;
              return (
                <li key={cat.categoryId ?? `none-${i}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${needs ? "bg-[var(--color-warning)]/15" : ""}`}>
                  <span>
                    {cat.category} <span className="tabular-nums text-[var(--color-muted-foreground)]">{money(cat.total)}</span>
                    {cat.source === "suggested" ? <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">suggested</span> : null}
                  </span>
                  {cat.categoryId ? (
                    <select
                      className="h-8 max-w-[18rem] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                      value={cat.source === "preparer" ? cat.lineCode ?? "" : ""}
                      disabled={savingId === cat.categoryId}
                      onChange={(e) => void setLine(cat.categoryId!, e.target.value || null)}
                      aria-label={`Schedule C line for ${cat.category}`}
                    >
                      <option value="">{cat.lineCode && cat.source === "suggested" ? `Suggested: line ${choices.find((o) => o.code === cat.lineCode)?.line ?? ""}` : "Choose a line"}</option>
                      {choices.map((o) => <option key={o.code} value={o.code}>Line {o.line}: {o.label}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs">Categorize these in the books first</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
