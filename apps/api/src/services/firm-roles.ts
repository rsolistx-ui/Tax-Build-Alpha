/**
 * Firm roles and what each may change. Reads (GET/HEAD/OPTIONS) are open to
 * every role; writes are checked here, on the server, for every request that
 * passes requireActiveBeta. There is no cap on how many members a firm has.
 *
 * - owner: everything, including money, staff and deleting clients.
 * - preparer: all client and tax work, including tax sign-off; no money or staff.
 * - bookkeeper: intake and bookkeeping (receipts, bank, documents, requests);
 *   no tax sign-off, money or staff.
 * - read_only: views everything, changes nothing.
 */
export const FIRM_ROLES = ["owner", "preparer", "bookkeeper", "read_only"] as const;
export type FirmRole = (typeof FIRM_ROLES)[number];
export const ASSIGNABLE_ROLES: FirmRole[] = ["preparer", "bookkeeper", "read_only"];

export function toFirmRole(value: string | null | undefined): FirmRole {
  // "staff" was the only non-owner role before roles existed; it had full client access.
  if (value === "staff") return "preparer";
  return (FIRM_ROLES as readonly string[]).includes(value ?? "") ? (value as FirmRole) : "read_only";
}

const CLIENT = "/api/clients/[^/]+";

// Paths below are the full mounted paths (see app.route in index.ts), not the
// sub-app's own. Every client write route is classified in firm-roles.test.ts.

// Money, staff and client deletion: owner only. Invoices and payments live
// under /api/billing; time-entry invoicing under /api/time-entries.
const OWNER_ONLY: RegExp[] = [
  /^\/api\/firm\/staff/,
  /^\/api\/billing(\/|$)/,
  /^\/api\/stripe(\/|$)/,
  /^\/api\/quickbooks(\/|$)/,
  /^\/api\/estimates(\/|$)/,
  /^\/api\/time-entries\/[^/]+\/entries\/convert-to-invoice$/,
];

// Tax judgment, taxpayer consent and signatures: owner and preparer.
const PREPARER_UP: RegExp[] = [
  new RegExp(
    `^${CLIENT}/(efile-authorizations|returns|tax-adjustments|m1-reconciliation|m3|carryforwards|state-mods|extensions|tax-form-mappings|tax-workpaper|tax-handoff|estimated-tax|home-office|dif-audit|advisory-roadmap|intercompany|engagements|signature-requests|docusign|consents)(/|$)`,
  ),
  new RegExp(`^${CLIENT}/tax-readiness/[^/]+$`),
  // Entity type, tax year and accounting basis (clients.ts PATCH /:id/profile).
  new RegExp(`^${CLIENT}/profile$`),
  new RegExp(`^${CLIENT}/export/signoff$`),
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function firmRoleAllows(role: FirmRole, method: string, path: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  if (role === "owner") return true;
  if (role === "read_only") return false;
  // DELETE /api/clients/:id removes a whole client.
  if (method.toUpperCase() === "DELETE" && new RegExp(`^${CLIENT}$`).test(path)) return false;
  if (OWNER_ONLY.some((r) => r.test(path))) return false;
  if (role === "bookkeeper" && PREPARER_UP.some((r) => r.test(path))) return false;
  return true;
}
