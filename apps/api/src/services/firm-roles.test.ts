import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firmRoleAllows, toFirmRole } from "./firm-roles";

describe("firmRoleAllows", () => {
  it("lets every role read ordinary client work and the team list", () => {
    for (const role of ["owner", "preparer", "bookkeeper", "read_only"] as const) {
      expect(firmRoleAllows(role, "GET", "/api/clients/cli_1/receipts")).toBe(true);
      expect(firmRoleAllows(role, "GET", "/api/clients/cli_1/consents")).toBe(true);
      expect(firmRoleAllows(role, "GET", "/api/firm/staff")).toBe(true);
    }
  });

  it("shows firm billing, estimates, Stripe and QuickBooks to the owner only", () => {
    expect(firmRoleAllows("owner", "GET", "/api/billing/cli_1/invoices")).toBe(true);
    for (const role of ["preparer", "bookkeeper", "read_only"] as const) {
      expect(firmRoleAllows(role, "GET", "/api/billing/cli_1/invoices")).toBe(false);
      expect(firmRoleAllows(role, "GET", "/api/billing/billing-rates")).toBe(false);
      expect(firmRoleAllows(role, "GET", "/api/estimates/cli_1/estimates")).toBe(false);
      expect(firmRoleAllows(role, "GET", "/api/stripe/connect/status")).toBe(false);
      expect(firmRoleAllows(role, "GET", "/api/quickbooks/status")).toBe(false);
    }
  });

  it("shows signed e-file and consent records to preparers and owners only", () => {
    for (const path of [
      "/api/clients/cli_1/efile-authorizations",
      "/api/clients/cli_1/efile-authorizations/ea_1/sealed",
      "/api/clients/cli_1/signature-vault",
      "/api/clients/cli_1/signature-requests",
      "/api/clients/cli_1/consents/printable",
      "/api/clients/cli_1/consents/con_1/text",
      "/api/clients/cli_1/export-archive",
    ]) {
      expect(firmRoleAllows("preparer", "GET", path), path).toBe(true);
      expect(firmRoleAllows("bookkeeper", "GET", path), path).toBe(false);
      expect(firmRoleAllows("read_only", "GET", path), path).toBe(false);
    }
  });

  it("gives the owner every write", () => {
    expect(firmRoleAllows("owner", "POST", "/api/billing/cli_1/invoices")).toBe(true);
    expect(firmRoleAllows("owner", "DELETE", "/api/clients/cli_1")).toBe(true);
  });

  it("keeps money, staff and client deletion with the owner (real mounted paths)", () => {
    for (const role of ["preparer", "bookkeeper"] as const) {
      expect(firmRoleAllows(role, "POST", "/api/billing/cli_1/invoices")).toBe(false);
      expect(firmRoleAllows(role, "POST", "/api/billing/cli_1/payments")).toBe(false);
      expect(firmRoleAllows(role, "POST", "/api/estimates/cli_1/estimates")).toBe(false);
      expect(firmRoleAllows(role, "POST", "/api/time-entries/cli_1/entries/convert-to-invoice")).toBe(false);
      expect(firmRoleAllows(role, "POST", "/api/firm/staff/invitations")).toBe(false);
      expect(firmRoleAllows(role, "DELETE", "/api/clients/cli_1")).toBe(false);
    }
    // Ordinary time tracking is not money movement.
    expect(firmRoleAllows("bookkeeper", "POST", "/api/time-entries/cli_1/entries")).toBe(true);
  });

  it("gives read-only no writes at all", () => {
    expect(firmRoleAllows("read_only", "POST", "/api/clients/cli_1/receipts")).toBe(false);
    expect(firmRoleAllows("read_only", "PATCH", "/api/clients/cli_1/bank-transactions/t1/disposition")).toBe(false);
  });
});

// Every write route under /api/clients/:clientId (or :id, as clients.ts names
// it) must be classified here, so a new route cannot silently fall open to
// bookkeepers. The segment is the first path part after the client param.
// DELETE /api/clients/:id is owner-only and covered in the tests above.
const BOOKKEEPER_MAY_WRITE = new Set([
  "agent-tasks", "bank-transactions", "categories", "portal-links", "requests", "documents", "sms-drop",
  "receipts", "mileage", "1099-radar", "checklist", "accounts",
  // clients.ts: PATCH /:id (name and contact details) and /:id/pipeline-status.
  "", "pipeline-status",
]);
const PREPARER_ONLY = new Set([
  "efile-authorizations", "returns", "tax-adjustments", "m1-reconciliation", "m3", "carryforwards", "state-mods",
  "extensions", "tax-form-mappings", "tax-workpaper", "tax-handoff", "estimated-tax", "home-office", "dif-audit",
  "advisory-roadmap", "intercompany", "engagements", "signature-requests", "docusign", "consents", "tax-readiness", "export", "profile",
]);

function clientWriteRoutes(): Array<{ file: string; path: string }> {
  const routesDir = join(__dirname, "..", "routes");
  const index = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
  const found: Array<{ file: string; path: string }> = [];
  for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(join(routesDir, file), "utf8");
    const app = src.match(/export const (\w+) = new Hono/)?.[1];
    if (!app || !index.includes(`app.route("/api/clients", ${app})`)) continue;
    for (const m of src.matchAll(/\.(post|put|patch|delete)\("\/:(?:clientId|id)(\/[^"]*)?"/g)) {
      if (m[1] === "delete" && !m[2]) continue;
      found.push({ file, path: `/:clientId${m[2] ?? ""}` });
    }
  }
  return found;
}

describe("every /api/clients write route is classified", () => {
  const routes = clientWriteRoutes();

  it("finds the client write routes", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("classifies each route's segment and enforces it", () => {
    for (const { file, path } of routes) {
      const segment = path.split("/")[2] ?? "";
      const concrete = `/api/clients/cli_1${path.slice("/:clientId".length).replace(/:[^/]+/g, "x")}`;
      const known = BOOKKEEPER_MAY_WRITE.has(segment) || PREPARER_ONLY.has(segment);
      expect(known, `${file}: ${path} is not classified in firm-roles.test.ts`).toBe(true);
      expect(firmRoleAllows("preparer", "POST", concrete), `${file}: ${path} (preparer)`).toBe(true);
      expect(firmRoleAllows("read_only", "POST", concrete), `${file}: ${path} (read-only)`).toBe(false);
      // tax-readiness: only the status PUT is sign-off; checklist work is bookkeeping.
      const bookkeeperExpected = segment === "tax-readiness" ? concrete.split("/").length > 6 : BOOKKEEPER_MAY_WRITE.has(segment);
      expect(firmRoleAllows("bookkeeper", "POST", concrete), `${file}: ${path} (bookkeeper)`).toBe(bookkeeperExpected);
    }
  });

  it("keeps export sign-off with the preparer even though export is bookkeeping", () => {
    expect(firmRoleAllows("bookkeeper", "POST", "/api/clients/cli_1/export/signoff")).toBe(false);
    expect(firmRoleAllows("preparer", "POST", "/api/clients/cli_1/export/signoff")).toBe(true);
  });
});

describe("toFirmRole", () => {
  it("maps the pre-roles 'staff' value to preparer and unknown values to read-only", () => {
    expect(toFirmRole("staff")).toBe("preparer");
    expect(toFirmRole("bookkeeper")).toBe("bookkeeper");
    expect(toFirmRole("admin")).toBe("read_only");
    expect(toFirmRole(null)).toBe("read_only");
  });
});
