import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { AppShell } from "@/components/layout/app-shell";
import { LockedScreen } from "@/components/locked";
import { api } from "@/lib/api";

type BetaStatus = { isOwner: boolean; allowed: boolean; reason: string | null };

export function ProtectedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const [firmName, setFirmName] = useState<string | undefined>();
  const [betaStatus, setBetaStatus] = useState<BetaStatus | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    void api<BetaStatus>("/api/beta/status")
      .then(setBetaStatus)
      .catch(() => setBetaStatus({ isOwner: false, allowed: false, reason: "BETA_REQUIRED" }));
  }, [session?.user]);

  useEffect(() => {
    if (!session?.user) return;
    if (!betaStatus?.allowed) return;
    void api<{ firm: { name: string } }>("/api/me")
      .then((d) => setFirmName(d.firm.name))
      .catch(() => undefined);
  }, [session?.user, betaStatus?.allowed]);

  if (isPending) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        Loading…
      </div>
    );
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />;
  }

  if (!betaStatus) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        Loading…
      </div>
    );
  }

  if (!betaStatus.allowed) {
    return <LockedScreen reason={betaStatus.reason} />;
  }

  return <AppShell firmName={firmName} userName={session.user.name} isOwner={betaStatus.isOwner} />;
}
