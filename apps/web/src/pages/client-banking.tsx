import { useParams, useNavigate } from "react-router-dom";
import { BankReconciliation } from "@/components/bank-reconciliation";

export function ClientBankingPage() {
  const { clientId = "" } = useParams();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Banking</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">Import bank activity, confirm matches, and resolve exceptions.</p>
      </div>
      <BankReconciliation
        clientId={clientId}
        onOpenReview={() => navigate(`/clients/${clientId}/receipts`)}
        onReceiptAdded={() => {}}
      />
    </div>
  );
}
