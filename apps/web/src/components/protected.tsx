import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { AppShell } from "@/components/layout/app-shell";
import { LockedScreen } from "@/components/locked";
import { MfaEnrollment } from "@/components/mfa-enrollment";
import { AgreementGate } from "@/components/agreement-gate";
import { api } from "@/lib/api";
import { FirmRoleProvider, type FirmRole } from "@/lib/firm-role";

type BetaStatus = {
  isOwner: boolean;
  allowed: boolean;
  reason: string | null;
  entitlement?: { status: string; startsAt: string; expiresAt: string } | null;
  mfaRequired?: boolean;
  firmRole?: FirmRole;
};

export function ProtectedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const [firmName, setFirmName] = useState<string | undefined>();
  const [betaStatus, setBetaStatus] = useState<BetaStatus | null>(null);
  const [agreementAccepted, setAgreementAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    void api<BetaStatus>("/api/beta/status")
      .then(setBetaStatus)
      .catch(() => setBetaStatus({ isOwner: false, allowed: false, reason: "BETA_REQUIRED" }));
  }, [session?.user]);

  useEffect(() => {
    if (!betaStatus?.allowed || betaStatus.isOwner) return;
    void api<{ accepted: boolean }>("/api/agreement").then((r) => setAgreementAccepted(r.accepted)).catch(() => setAgreementAccepted(false));
  }, [betaStatus?.allowed, betaStatus?.isOwner]);

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

  // 16 CFR 314.4(c)(5): no client data until two-step sign-in is on (enforced when the server sets REQUIRE_MFA).
  if (betaStatus.mfaRequired && !(session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) {
    return <MfaEnrollment />;
  }

  // 16 CFR 314.4(f)(2): firms accept the service-provider agreement once per version. The operator is exempt.
  if (!betaStatus.isOwner) {
    if (agreementAccepted === null) {
      return <div className="flex min-h-full items-center justify-center text-sm text-[var(--color-muted-foreground)]">Loading…</div>;
    }
    if (!agreementAccepted) return <AgreementGate onAccepted={() => setAgreementAccepted(true)} />;
  }

  const daysLeft =
    !betaStatus.isOwner && betaStatus.entitlement?.expiresAt
      ? Math.max(0, Math.ceil((new Date(betaStatus.entitlement.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : undefined;

  return (
    <FirmRoleProvider value={betaStatus.firmRole ?? "owner"}>
      <AppShell
        firmName={firmName}
        userName={session.user.name}
        isOwner={betaStatus.isOwner}
        daysLeft={daysLeft}
      />
    </FirmRoleProvider>
  );
}
