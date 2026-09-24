import { createContext, useContext } from "react";

export type FirmRole = "owner" | "preparer" | "bookkeeper" | "read_only";

// Mirrors the server's read rules in apps/api/src/services/firm-roles.ts. The
// server enforces them; this only hides screens a role cannot open.
const FirmRoleContext = createContext<FirmRole>("owner");

export const FirmRoleProvider = FirmRoleContext.Provider;

export function useFirmRole(): FirmRole {
  return useContext(FirmRoleContext);
}

/** Firm billing, invoices, payments, estimates, Stripe and QuickBooks. */
export function canSeeBilling(role: FirmRole): boolean {
  return role === "owner";
}

/** E-file authorizations (8879/8878), the signature vault and signed consent text. */
export function canSeeSignedRecords(role: FirmRole): boolean {
  return role === "owner" || role === "preparer";
}
