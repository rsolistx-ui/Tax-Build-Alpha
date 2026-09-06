import { useEffect, useState } from "react";
import { Outlet, useParams, useSearchParams } from "react-router-dom";
import { ClientWorkspaceHeader } from "@/components/layout/workspace-shell";
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

type PeriodState = { state: "open" | "closed"; canClose: boolean };

export type ClientOutletContext = {
  currentPeriod: string | undefined;
  onPeriodChange: (period: string) => void;
  ledgerVersion: number;
};

export function ClientWorkspacePage() {
  const { clientId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { client, setClient, currentPeriod, setCurrentPeriod, setOnPeriodChange } = useWorkspace();
  const [statusSummary, setStatusSummary] = useState<StatusSummary>({
    openExceptions: 0,
    pendingReceipts: 0,
    uncategorized: 0,
    reviewItems: 0,
    needsReview: 0,
  });
  const [periodState, setPeriodState] = useState<PeriodState | null>(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
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
        state: "open" | "closed";
        canClose: boolean;
        blockers: string[];
        summary: Record<string, { count: number; total: number }>;
      }>(`/api/clients/${clientId}/periods/${periodKey}/summary`);

      setPeriodState({ state: summary.state, canClose: summary.canClose });

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

  async function closePeriod() {
    if (!currentPeriod) return;
    setError(null);
    try {
      await api(`/api/clients/${clientId}/periods/${currentPeriod}/close`, { method: "POST", body: "{}" });
      await loadStatusSummary(currentPeriod);
      setLedgerVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close the period");
    }
  }

  async function reopenPeriod() {
    if (!currentPeriod) return;
    const reason = window.prompt("Why is this period being reopened? (required, at least 5 characters)");
    if (!reason || reason.trim().length < 5) return;
    setError(null);
    try {
      await api(`/api/clients/${clientId}/periods/${currentPeriod}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await loadStatusSummary(currentPeriod);
      setLedgerVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen the period");
    }
  }

  // Registers this page's full period-change handler (URL sync + summary
  // reload) so the permanent shell's top-level period selector invokes it
  // instead of only updating shared state. Runs every render (cheap ref
  // assignment) so it always points at the latest closure.
  useEffect(() => {
    setOnPeriodChange(handlePeriodChange);
    return () => setOnPeriodChange(null);
  });

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
        periodState={periodState}
        onClosePeriod={() => void closePeriod()}
        onReopenPeriod={() => void reopenPeriod()}
      />

      {error ? (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <Outlet context={{ currentPeriod: currentPeriod || undefined, onPeriodChange: handlePeriodChange, ledgerVersion } satisfies ClientOutletContext} />
      )}
    </>
  );
}
