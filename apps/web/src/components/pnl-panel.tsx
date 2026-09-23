import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Pnl } from "@/types/pnl";
import { SpendingPieChart, getCategoryColor, useIsDark } from "@/components/spending-pie-chart";

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--color-muted)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</p>
      <p className="mt-1 text-xl font-semibold">${Number(value).toFixed(2)}</p>
    </div>
  );
}

export function PnlPanel({
  pnl,
  apiUrl,
  onSelectExpenseCategory,
  onSelectIncomeCategory,
}: {
  pnl: Pnl | null;
  apiUrl: (path: string) => string;
  onSelectExpenseCategory: (category: string) => void;
  onSelectIncomeCategory: (category: string) => void;
}) {
  const isDark = useIsDark();
  const sortedExpenses = [...(pnl?.categorizedExpenses ?? [])].sort((a, b) => b.total - a.total);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" /> Evidence-backed P&amp;L
        </CardTitle>
        <CardDescription>{pnl?.note ?? "Loading…"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pnl && pnl.accrualSupported === false ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Accrual reporting is not available in the paid alpha. No P&amp;L figures can be shown for this client until it is switched to cash basis.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Summary label="Income" value={pnl?.income ?? 0} />
              <Summary label="Expenses" value={pnl?.expenses ?? 0} />
              <Summary label="Net" value={pnl?.net ?? 0} />
            </div>

            {pnl?.counts ? (
              <div className="flex flex-wrap gap-2 text-xs text-[var(--color-muted-foreground)]">
                <span>{pnl.counts.filedReceipts} filed receipt(s)</span>
                <span>·</span>
                <span>{pnl.counts.matchedBankTransactions} matched bank txn(s)</span>
                <span>·</span>
                <span>{pnl.counts.noReceiptBusinessExpenses} no-receipt expense(s)</span>
                <span>·</span>
                <span>{pnl.counts.businessIncomeTransactions} income txn(s)</span>
              </div>
            ) : null}

            {pnl && pnl.excludedFiledReceiptCount ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">
                    {pnl.excludedFiledReceiptCount} filed receipt(s) are excluded from operating expenses because their matched bank transactions were classified as nonbusiness.
                  </p>
                  <div className="mt-2 space-y-1">
                    {(pnl.excludedFiledReceipts ?? []).map((r) => (
                      <a
                        key={r.receiptId}
                        href={apiUrl(r.sourceUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs underline hover:no-underline"
                      >
                        {r.merchant || r.filename}
                        {r.date ? ` · ${r.date}` : ""} — matched bank txn classified {r.bankDisposition.replace(/_/g, " ")}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Expenses by category</p>
              {sortedExpenses.length > 0 ? <SpendingPieChart categorizedExpenses={sortedExpenses} /> : null}
              <div className="space-y-2">
                {sortedExpenses.map((row, i) => (
                  <button
                    type="button"
                    key={row.category}
                    onClick={() => onSelectExpenseCategory(row.category)}
                    className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-3 text-left text-sm hover:bg-[var(--color-muted)]/60"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          background:
                            sortedExpenses.length > 8 && i >= 7
                              ? "#98968f"
                              : getCategoryColor(i, isDark),
                        }}
                        aria-hidden="true"
                      />
                      <div>
                        <span className="font-medium capitalize">{row.category}</span>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {row.receiptCount} receipt line(s){row.bankCount > 0 ? `, ${row.bankCount} no-receipt bank txn(s)` : ""}
                        </p>
                      </div>
                    </div>
                    <span className="font-medium">${Number(row.total).toFixed(2)}</span>
                  </button>
                ))}
                {sortedExpenses.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">No business expenses in this period.</p>
                ) : null}
              </div>
            </div>

            {pnl?.categorizedIncome?.length ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Income by category</p>
                <div className="space-y-2">
                  {pnl.categorizedIncome.map((row) => (
                    <button
                      type="button"
                      key={row.category}
                      onClick={() => onSelectIncomeCategory(row.category)}
                      className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-3 text-left text-sm hover:bg-[var(--color-muted)]/60"
                    >
                      <span className="font-medium capitalize">{row.category}</span>
                      <span className="font-medium">${Number(row.total).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
