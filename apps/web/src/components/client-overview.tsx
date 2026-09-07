import { useEffect, useState } from "react";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

type OverviewAction = {
  id: string;
  type: string;
  explanation: string;
  deepLink: string;
};

type Overview = {
  header: {
    clientName: string;
    legalName: string | null;
    entityType: string | null;
    industry: string | null;
    state: string | null;
    taxYear: number | null;
    accountingBasis: string | null;
    reportingCurrency: string;
    bookkeepingReadiness: string;
    taxReadiness: string | null;
    openActionCount: number;
    lastActivityAt: string;
  };
  financialStatus: {
    pnlCompleteness: boolean;
    bankTransactionCount: number;
    missingEvidenceCount: number;
    unclassifiedCount: number;
    uncategorizedCount: number;
    currencyConflictCount: number;
  };
  documentStatus: {
    receiptsReceived: number;
    receiptsAwaitingReview: number;
    filedReceipts: number;
    missingEvidence: number;
    taxDocumentsReceived: number;
    taxDocumentsRequested: number;
    documentsAwaitingReview: number;
  };
  nextActions: OverviewAction[];
};

const READINESS_LABEL: Record<string, string> = {
  ready: "Ready",
  needs_review: "Needs review",
  missing_evidence: "Missing evidence",
  books_incomplete: "Books incomplete",
};

const TAX_READINESS_LABEL: Record<string, string> = {
  not_started: "Not started",
  collecting_documents: "Collecting documents",
  bookkeeping_incomplete: "Bookkeeping incomplete",
  professional_review: "Professional review",
  ready_for_preparation: "Ready for preparation",
  preparation_started: "Preparation started",
  complete: "Complete",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
      <div className="text-lg font-semibold tabular-nums" style={tone === "warn" ? { color: "var(--color-warning)" } : undefined}>
        {value}
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
    </div>
  );
}

export function ClientOverview({ clientId, onNavigate }: { clientId: string; onNavigate: (deepLink: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api<Overview>(`/api/clients/${clientId}/overview`)
      .then(setOverview)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load client overview"));
  }, [clientId]);

  if (error) return <p className="text-sm text-[var(--color-destructive)]">{error}</p>;
  if (!overview) return <p className="text-sm text-[var(--color-muted-foreground)]">Loading overview...</p>;

  const { header, financialStatus, documentStatus, nextActions } = overview;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Legal name" value={header.legalName || "Not set"} />
          <Field label="Entity type" value={header.entityType || "Not set"} />
          <Field label="Industry" value={header.industry || "Not set"} />
          <Field label="State" value={header.state || "Not set"} />
          <Field label="Tax year" value={header.taxYear ? String(header.taxYear) : "Not set"} />
          <Field label="Accounting basis" value={header.accountingBasis || "Not set"} />
          <Field label="Reporting currency" value={header.reportingCurrency} />
          <Field label="Bookkeeping readiness" value={READINESS_LABEL[header.bookkeepingReadiness] ?? header.bookkeepingReadiness} />
          <Field label="Tax readiness" value={header.taxReadiness ? TAX_READINESS_LABEL[header.taxReadiness] ?? header.taxReadiness : "Not started"} />
          <Field label="Open actions" value={String(header.openActionCount)} />
          <Field label="Last activity" value={new Date(header.lastActivityAt).toLocaleDateString()} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">Financial status</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Bank transactions" value={financialStatus.bankTransactionCount} />
              <Metric label="Missing evidence" value={financialStatus.missingEvidenceCount} tone={financialStatus.missingEvidenceCount > 0 ? "warn" : undefined} />
              <Metric label="Unclassified" value={financialStatus.unclassifiedCount} tone={financialStatus.unclassifiedCount > 0 ? "warn" : undefined} />
              <Metric label="Uncategorized" value={financialStatus.uncategorizedCount} />
              <Metric label="Currency conflicts" value={financialStatus.currencyConflictCount} tone={financialStatus.currencyConflictCount > 0 ? "warn" : undefined} />
              <Metric label="P&L complete" value={financialStatus.pnlCompleteness ? "Yes" : "No"} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">Document status</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Receipts received" value={documentStatus.receiptsReceived} />
              <Metric label="Awaiting review" value={documentStatus.receiptsAwaitingReview} tone={documentStatus.receiptsAwaitingReview > 0 ? "warn" : undefined} />
              <Metric label="Filed receipts" value={documentStatus.filedReceipts} />
              <Metric label="Tax docs received" value={documentStatus.taxDocumentsReceived} />
              <Metric label="Tax docs requested" value={documentStatus.taxDocumentsRequested} tone={documentStatus.taxDocumentsRequested > 0 ? "warn" : undefined} />
              <Metric label="Docs awaiting review" value={documentStatus.documentsAwaitingReview} tone={documentStatus.documentsAwaitingReview > 0 ? "warn" : undefined} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">Next actions</h3>
          {nextActions.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing outstanding" description="No open actions for this client right now." />
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {nextActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onNavigate(action.deepLink)}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-[var(--color-foreground)]"
                >
                  <span className="flex items-center gap-2">
                    <Badge>{action.type.replace(/_/g, " ")}</Badge>
                    {action.explanation}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
