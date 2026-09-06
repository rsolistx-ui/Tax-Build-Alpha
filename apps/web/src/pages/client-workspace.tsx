import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ClientWorkspaceHeader } from "@/components/layout/workspace-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/empty-state";
import { Inbox } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";

type Client = { id: string; name: string };

type StatusSummary = {
  openExceptions: number;
  pendingReceipts: number;
  uncategorized: number;
  reviewItems: number;
  needsReview: number;
};

export function ClientWorkspacePage() {
  const { clientId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { client, setClient, currentPeriod, setCurrentPeriod } = useWorkspace();
  const [statusSummary, setStatusSummary] = useState<StatusSummary>({
    openExceptions: 0,
    pendingReceipts: 0,
    uncategorized: 0,
    reviewItems: 0,
    needsReview: 0,
  });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const clientData = await api<{ client: Client }>(`/api/clients/${clientId}`);
      setClient(clientData.client);
      const period = searchParams.get("period") || new Date().toISOString().slice(0, 7);
      setCurrentPeriod(period);
      await loadStatusSummary(period);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace");
    }
  }

  async function loadStatusSummary(periodKey: string) {
    try {
      const summary = await api<{
        blockers: string[];
        summary: Record<string, { count: number; total: number }>;
      }>(`/api/clients/${clientId}/periods/${periodKey}/summary`);

      let openExceptions = 0;
      let pendingReceipts = 0;
      let uncategorized = 0;
      let reviewItems = 0;
      let needsReview = 0;

      for (const blocker of summary.blockers) {
        if (blocker.includes("unresolved bank exception")) {
          openExceptions = parseInt(blocker.split(" ")[0], 10);
        } else if (blocker.includes("pending linked receipt")) {
          pendingReceipts = parseInt(blocker.split(" ")[0], 10);
        } else if (blocker.includes("uncategorized business ledger row")) {
          uncategorized = parseInt(blocker.split(" ")[0], 10);
        } else if (blocker.includes("receipt(s) in review")) {
          reviewItems = parseInt(blocker.split(" ")[0], 10);
        } else if (blocker.includes("ledger entry(ies) need review")) {
          needsReview = parseInt(blocker.split(" ")[0], 10);
        }
      }

      setStatusSummary({
        openExceptions,
        pendingReceipts,
        uncategorized,
        reviewItems,
        needsReview,
      });
    } catch {
      // Ignore
    }
  }

  useEffect(() => {
    void load();
    return () => setClient(null);
  }, [clientId]);

  function handlePeriodChange(period: string) {
    setCurrentPeriod(period);
    setSearchParams({ period }, { replace: true });
    void loadStatusSummary(period);
  }

  if (!client) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <EmptyState icon={Inbox} title="Loading…" description="Loading client workspace" />
      </div>
    );
  }

  return (
    <>
      <ClientWorkspaceHeader
        client={client}
        currentPeriod={currentPeriod || undefined}
        onPeriodChange={handlePeriodChange}
        statusSummary={statusSummary}
      />

      {error ? (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <TransactionsTable
          clientId={clientId}
          initialPeriod={currentPeriod || undefined}
          onPeriodChange={handlePeriodChange}
        />
      )}
    </>
  );
}
