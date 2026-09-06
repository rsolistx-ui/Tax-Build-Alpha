import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { api } from "@/lib/api";

export function ProtectedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const [firmName, setFirmName] = useState<string | undefined>();

  useEffect(() => {
    if (!session?.user) return;
    void api<{ firm: { name: string } }>("/api/me")
      .then((d) => setFirmName(d.firm.name))
      .catch(() => undefined);
  }, [session?.user]);

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

  return <WorkspaceShell firmName={firmName} userName={session.user.name} />;
}
