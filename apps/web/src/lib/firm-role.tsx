import { createContext, useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export type FirmRole = "owner" | "preparer" | "bookkeeper" | "read_only";

// Mirrors the server's read rules in apps/api/src/services/firm-roles.ts. The
// server enforces them; this only hides screens a role cannot open.
const FirmRoleContext = createContext<FirmRole>("owner");

export const FirmRoleProvider = FirmRoleContext.Provider;

export function useFirmRole(): FirmRole {
  return useContext(FirmRoleContext);
}

// False for staff the owner limits to assigned clients (client assignment,
// apps/api/src/services/client-assignment.ts). The server refuses their
// firm-wide screens; this hides them.
const SeesAllClientsContext = createContext<boolean>(true);

export const SeesAllClientsProvider = SeesAllClientsContext.Provider;

export function useSeesAllClients(): boolean {
  return useContext(SeesAllClientsContext);
}

/** Stands in for a firm-wide screen when the user sees only assigned clients. */
export function AllClientsOnly({ children }: { children: ReactNode }) {
  if (useSeesAllClients()) return <>{children}</>;
  return (
    <EmptyState
      icon={Users}
      title="Open one of your clients"
      description="Your firm owner gives you access client by client. This page covers the whole firm, so it is not available to you."
      action={<Button asChild><Link to="/clients">Your clients</Link></Button>}
    />
  );
}

/** Firm billing, invoices, payments, estimates, Stripe and QuickBooks. */
export function canSeeBilling(role: FirmRole): boolean {
  return role === "owner";
}

/** E-file authorizations (8879/8878), the signature vault and signed consent text. */
export function canSeeSignedRecords(role: FirmRole): boolean {
  return role === "owner" || role === "preparer";
}
