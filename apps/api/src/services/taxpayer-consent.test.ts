import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import type { Env } from "../env";
import type { ClientRow } from "./clients";
import { buildConsentText, hasDocumentReadingConsent, resolveExpiry, signConsentElectronically, type ConsentParties } from "./taxpayer-consent";
import { ingestReceiptForClient } from "./receipt-intake";
import { activeDocumentReaders } from "../providers/llm";

const parties: ConsentParties = {
  preparerName: "Example Tax Services",
  taxpayerName: "Pat Client",
  readers: [{ id: "cloudflare-workers-ai", legalName: "Cloudflare, Inc.", service: "Workers AI", usOnly: false }, { id: "groq", legalName: "Groq, Inc.", service: "GroqCloud", usOnly: false }],
};

// Rev. Proc. 2013-14 § 5.04(1): mandatory statements, verbatim and in sequence.
const DISCLOSE_B_1 = "Federal law requires this consent form be provided to you. Unless authorized by law, we cannot disclose your tax return information to third parties for purposes other than those related to the preparation and filing of your tax return without your consent. If you consent to the disclosure of your tax return information, Federal law may not protect your tax return information from further use or distribution.";
const DISCLOSE_B_2 = "You are not required to complete this form. Because our ability to disclose your tax return information to another tax return preparer affects the tax return preparation service(s) that we provide to you and its (their) cost, we may decline to provide you with tax return preparation services or change the terms (including the cost) of the tax return preparation services that we provide to you if you do not sign this form. If you agree to the disclosure of your tax return information, your consent is valid for the amount of time that you specify. If you do not specify the duration of your consent, your consent is valid for one year from the date of signature.";
const USE_C_1 = "Federal law requires this consent form be provided to you. Unless authorized by law, we cannot use your tax return information for purposes other than the preparation and filing of your tax return without your consent.";
const USE_C_2 = "You are not required to complete this form to engage our tax return preparation services. If we obtain your signature on this form by conditioning our tax return preparation services on your consent, your consent will not be valid. Your consent is valid for the amount of time that you specify. If you do not specify the duration of your consent, your consent is valid for one year from the date of signature.";
const TIGTA = "If you believe your tax return information has been disclosed or used improperly in a manner unauthorized by law or without your permission, you may contact the Treasury Inspector General for Tax Administration (TIGTA) by telephone at 1-800-366-4484, or by email at complaints@tigta.treas.gov.";
const FOREIGN = "This consent to disclose may result in your tax return information being disclosed to a tax return preparer located outside the United States.";

describe("consent text (Rev. Proc. 2013-14)", () => {
  it("disclosure consent carries §5.04(1)(b), (d) and (e)(i) statements verbatim, in sequence, and names every party", () => {
    const text = buildConsentText("disclosure_document_reading", parties);
    const order = [DISCLOSE_B_1, DISCLOSE_B_2, FOREIGN, TIGTA].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const name of ["Example Tax Services", "Pat Client", "Cloudflare, Inc. (Workers AI)", "Groq, Inc. (GroqCloud)", "Truepost"]) expect(text).toContain(name);
    expect(text).toContain("Social Security number");
  });

  it("use consent is a separate document with §5.04(1)(c) and (d) statements and no disclosure language", () => {
    const text = buildConsentText("use_bookkeeping", parties);
    expect(text.indexOf(USE_C_1)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(USE_C_2)).toBeGreaterThan(text.indexOf(USE_C_1));
    expect(text).toContain(TIGTA);
    expect(text).not.toContain("disclose your tax return information to third parties");
  });

  it("defaults to one year and rejects end dates in the past or beyond five years", () => {
    const signed = new Date("2026-09-22T15:00:00Z");
    expect(resolveExpiry(signed)).toBe("2027-09-22");
    expect(resolveExpiry(signed, "2028-01-31")).toBe("2028-01-31");
    expect(() => resolveExpiry(signed, "2026-09-01")).toThrow(/after today/);
    expect(() => resolveExpiry(signed, "2032-01-01")).toThrow(/five years/);
  });
});

function mockDb(handler: (sql: string, params: unknown[]) => unknown[] | undefined = () => undefined) {
  const statements: DbStatement[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) { statements.push({ query: sql, params }); return (handler(sql, params) ?? []) as T[]; },
    async transaction<T>(batch: DbStatement[]) { statements.push(...batch); return batch.map((s) => handler(s.query, s.params ?? []) ?? []) as T[][]; },
  };
  return { db, statements };
}

describe("electronic signature (Rev. Proc. 2013-14 § 6)", () => {
  const env = { AI: {} } as unknown as Env;
  const request = { id: "cnreq_1", firm_id: "firm_1", client_id: "cli_1", expires_at: "2026-10-06T00:00:00Z" };
  const clientRow = () => [{ firm_name: "Example Tax Services", client_name: "Pat Client", legal_name: null }];

  it("requires the affirmative checkbox and a typed name", async () => {
    const { db } = mockDb((sql) => sql.includes("FROM clients c JOIN firms") ? clientRow() : undefined);
    await expect(signConsentElectronically(db, env, request, { kind: "disclosure_document_reading", authorized: false, typedName: "Pat Client", ip: null, userAgent: null })).rejects.toThrow(/Check the box/);
    await expect(signConsentElectronically(db, env, request, { kind: "disclosure_document_reading", authorized: true, typedName: " ", ip: null, userAgent: null })).rejects.toThrow(/Type your full name/);
  });

  it("stores the exact text signed, its recipients, and a one-year default expiry", async () => {
    const { db, statements } = mockDb((sql) => sql.includes("FROM clients c JOIN firms") ? clientRow() : undefined);
    const result = await signConsentElectronically(db, env, request, { kind: "disclosure_document_reading", authorized: true, typedName: "Pat Client", ip: "203.0.113.9", userAgent: "test" });
    const insert = statements.find((s) => s.query.includes("INSERT INTO taxpayer_consents"))!;
    expect(insert.params![5]).toBe(result.consentText);
    expect(result.consentText).toContain("I, Pat Client, authorize Example Tax Services to disclose");
    expect(JSON.parse(String(insert.params![7]))).toEqual(["truepost", "cloudflare-workers-ai"]);
    expect(insert.params![10]).toBe("typed_name");
  });
});

describe("receipt pipeline gate (IRC § 7216)", () => {
  const client: ClientRow = { id: "cli_1", firm_id: "firm_1", name: "Acme", legal_name: null, notes: null, email: null, phone: null, pipeline_status: "active", created_at: "now", updated_at: "now" };

  it("never calls a reading service without a signed disclosure consent, and keeps the file for manual entry", async () => {
    let aiCalled = false;
    const env = {
      AI: { run: async () => { aiCalled = true; return {}; }, toMarkdown: async () => { aiCalled = true; return { format: "markdown", data: "" }; } },
      RECEIPTS: { put: async () => ({}) },
    } as unknown as Env;
    const { db, statements } = mockDb((sql) => sql.includes("UPDATE jobs SET status = 'finalizing'") ? [{ id: "job_1" }] : undefined);
    const result = await ingestReceiptForClient(db, env, client, new File([new Uint8Array([1])], "r.png", { type: "image/png" }), "user_1", null);
    expect(aiCalled).toBe(false);
    expect(result).toMatchObject({ ok: true, readingSkipped: "consent_required" });
    expect(statements.some((s) => String(s.params?.[0] ?? "").includes("CONSENT_REQUIRED"))).toBe(true);
  });

  it("requires the consent to name every configured service", async () => {
    let requiredJson = "";
    const { db } = mockDb((sql, params) => { if (sql.includes("recipients @>")) requiredJson = String(params[1]); return []; });
    await hasDocumentReadingConsent(db, "cli_1", activeDocumentReaders({ AI: {}, GROQ_API_KEY: "k" } as unknown as Env).map((r) => r.id));
    expect(JSON.parse(requiredJson)).toEqual(["truepost", "cloudflare-workers-ai", "groq"]);
  });
});
