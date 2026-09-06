import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DrilldownState } from "@/types/pnl";

export function DrilldownPanel({
  drilldown,
  apiUrl,
}: {
  drilldown: DrilldownState;
  apiUrl: (path: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source drill-down</CardTitle>
        <CardDescription>
          {drilldown
            ? drilldown.type === "income"
              ? `Showing every bank transaction behind income category ${drilldown.category}.`
              : `Showing every filed line and no-receipt bank transaction behind ${drilldown.category}.`
            : "Select a P&L category to trace it back to evidence."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {drilldown && drilldown.type === "income" ? (
          <div className="space-y-2">
            {drilldown.entries.map((entry) => (
              <div key={`i-${entry.bankTransactionId}`} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.description || "Bank income"}</p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {entry.date ? entry.date : "No date"} · {entry.category}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">${Number(entry.reportedAmount).toFixed(2)}</p>
                    <p className="text-[10px] text-[var(--color-muted-foreground)]">reported</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
                  <span>Original bank amount: ${Number(entry.amount).toFixed(2)}</span>
                  <span>Bank transaction {entry.bankTransactionId}</span>
                </div>
                {entry.dispositionNote ? (
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Note: {entry.dispositionNote}</p>
                ) : null}
                {entry.sourceFilename || entry.sourceRow !== null || entry.importBatchId ? (
                  <details className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                    <summary className="cursor-pointer select-none font-medium">Source import details</summary>
                    <div className="mt-1 space-y-0.5 pl-2">
                      {entry.sourceFilename ? <p>File: {entry.sourceFilename}</p> : null}
                      {entry.sourceRow !== null ? <p>CSV row: {entry.sourceRow}</p> : null}
                      {entry.importBatchId ? <p>Import batch: {entry.importBatchId}</p> : null}
                      {entry.originalRow ? (
                        <pre className="mt-1 overflow-x-auto rounded bg-[var(--color-muted)]/40 p-2 text-[10px]">
                          {JSON.stringify(entry.originalRow, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            ))}
            {drilldown.entries.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No entries for this category and period.</p>
            ) : null}
          </div>
        ) : drilldown && drilldown.type === "expense" ? (
          <div className="space-y-2">
            {drilldown.entries.map((entry, index) => (
              <div key={`r-${entry.receiptId}-${entry.lineNo ?? index}`} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.merchant || entry.filename}</p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {entry.description}
                      {entry.date ? ` · ${entry.date}` : ""}
                    </p>
                  </div>
                  <span className="font-medium">${Number(entry.amount).toFixed(2)}</span>
                </div>
                <a
                  href={apiUrl(entry.sourceUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                >
                  View source <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
            {drilldown.bankEntries.map((entry) => (
              <div key={`b-${entry.bankTransactionId}`} className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.description}</p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      No receipt required{entry.date ? ` · ${entry.date}` : ""}
                    </p>
                  </div>
                  <span className="font-medium">${Number(entry.amount).toFixed(2)}</span>
                </div>
                {entry.noReceiptReason ? (
                  <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">Reason: {entry.noReceiptReason}</p>
                ) : null}
              </div>
            ))}
            {drilldown.entries.length === 0 && drilldown.bankEntries.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No entries for this category and period.</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">Nothing selected.</p>
        )}
      </CardContent>
    </Card>
  );
}
