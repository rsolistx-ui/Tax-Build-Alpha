import { useEffect, useState } from "react";
import { Landmark, Link2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

type ProviderStatus = { plaid: { available: boolean; environment: string } };

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit?: (error: { error_message?: string } | null) => void;
      }) => { open: () => void };
    };
  }
}

let plaidScript: Promise<void> | null = null;

function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  if (plaidScript) return plaidScript;
  plaidScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Plaid Link could not be loaded. Check the connection and try again."));
    document.head.appendChild(script);
  });
  return plaidScript;
}

export function BankFeedConnect({ clientId, onConnected }: { clientId: string; onConnected?: () => void }) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void api<ProviderStatus>("/api/bank-connectivity/providers").then(setStatus).catch(() => setStatus({ plaid: { available: false, environment: "not configured" } }));
  }, []);

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const [{ linkToken }, _] = await Promise.all([
        api<{ linkToken: string }>("/api/bank-connectivity/connect/link-token", { method: "POST", body: JSON.stringify({ provider: "plaid", clientId, products: ["transactions"] }) }),
        loadPlaid(),
      ]);
      if (!window.Plaid) throw new Error("Plaid Link did not initialize.");
      window.Plaid.create({
        token: linkToken,
        onSuccess: (publicToken) => {
          void api<{ connection?: { id?: string } }>("/api/bank-connectivity/connect/exchange", { method: "POST", body: JSON.stringify({ provider: "plaid", publicToken, clientId }) })
            .then(async (connection: { connection?: { id?: string } }) => {
              const connectionId = connection.connection?.id;
              if (!connectionId) throw new Error("The bank connection was saved, but no connection ID was returned.");
              const sync = await api<{ queuedForReview?: number }>(`/api/bank-connectivity/connections/${connectionId}/sync`, { method: "POST", body: JSON.stringify({}) });
              setMessage(sync.queuedForReview ? `${sync.queuedForReview} transaction${sync.queuedForReview === 1 ? "" : "s"} entered the review queue.` : "Bank connected. There are no settled transactions ready for review yet.");
              onConnected?.();
            })
            .catch((error) => setMessage(error instanceof Error ? error.message : "The bank connection could not be saved."));
        },
        onExit: (error) => {
          if (error?.error_message) setMessage(error.error_message);
        },
      }).open();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The bank connection could not be started.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  if (!status.plaid.available) {
    return <p className="text-xs text-[var(--color-muted-foreground)]">Live bank sync is not configured yet. CSV import remains available.</p>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/35 p-3">
      <div className="flex min-w-0 items-start gap-2">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Connect bank securely</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">Choose the institution once. New transactions enter review; nothing is posted automatically.</p>
        </div>
      </div>
      <Button type="button" size="sm" onClick={() => void connect()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        {busy ? "Opening secure bank link…" : "Connect bank"}
      </Button>
      {message ? <p className="w-full text-xs text-[var(--color-muted-foreground)]" aria-live="polite">{message}</p> : null}
    </div>
  );
}
