import { useParams, useOutletContext } from "react-router-dom";
import { TransactionsTable } from "@/components/transactions-table";
import type { ClientOutletContext } from "@/pages/client-workspace";

export function ClientOverviewPage() {
  const { clientId = "" } = useParams();
  const { currentPeriod, onPeriodChange } = useOutletContext<ClientOutletContext>();

  return (
    <TransactionsTable
      clientId={clientId}
      initialPeriod={currentPeriod}
      onPeriodChange={onPeriodChange}
    />
  );
}
