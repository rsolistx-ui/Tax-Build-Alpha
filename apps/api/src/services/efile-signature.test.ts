import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Db, DbStatement } from "../db";
import {
  acceptHandwrittenCopy, assertReturnSigned, createEfileAuthorization, recordKbaAttempt, retentionUntil,
  signInPerson, signRemotelyAfterKba, validateTaxpayerPin, verifyEfileEvidence, type EfileAuthorizationRow,
} from "./efile-signature";
import { resolveKbaProvider, type KbaProvider } from "./kba-providers";
import { sha256Hex } from "./documents";

// 1x1 transparent PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const PNG_DATA_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

async function onePagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

function r2() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    RECEIPTS: {
      async put(key: string, value: Uint8Array) { objects.set(key, new Uint8Array(value)); return {}; },
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes ? { body: bytes, arrayBuffer: async () => bytes.slice().buffer } : null;
      },
    } as any,
  };
}

type Handler = (sql: string, params: unknown[]) => unknown[] | undefined;
function mockDb(handler: Handler = () => undefined) {
  const statements: DbStatement[] = [];
  const run = (sql: string, params: unknown[] = []) => handler(sql, params) ?? [{ id: "row" }];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) { statements.push({ query: sql, params }); return run(sql, params) as T[]; },
    async transaction<T>(batch: DbStatement[]) { statements.push(...batch); return batch.map((s) => run(s.query, s.params ?? [])) as T[][]; },
  };
  return { db, statements };
}

function authorization(overrides: Partial<EfileAuthorizationRow> = {}): EfileAuthorizationRow {
  return {
    id: "efa_1", firm_id: "firm_1", client_id: "cli_1", signature_request_id: "sigr_1", tax_return_id: "ret_1",
    tax_year: 2025, form_type: "8879", taxpayer_role: "primary", taxpayer_name: "Pat Taxpayer", taxpayer_email: "pat@example.com",
    unsigned_r2_key: "prepared.pdf", unsigned_hash: "a".repeat(64), status: "awaiting_signature", signed_method: null,
    received_r2_key: null, received_content_type: null, received_hash: null, received_at: null, received_ip: null,
    received_user_agent: null, kba_failed_attempts: 0, created_at: "2026-03-01T00:00:00Z", voided_at: null, void_reason: null,
    ...overrides,
  };
}

const photoId = {
  mode: "photo_id" as const,
  inspection: { idType: "drivers_license" as const, idNumberLast4: "1234", legalName: "Pat Taxpayer", ssnLast4: "6789",
    address: "1 Main St, Austin TX 78701", dateOfBirth: "1980-05-01", photoMatchesTaxpayer: true as const },
};
const typed = { signatureType: "typed" as const, signatureData: "Pat", signerName: "Pat", taxpayerPin: "24680" };

describe("retention and PIN rules", () => {
  it("keeps records three years past the April 15 due date, or past a later signing date", () => {
    expect(retentionUntil(2025, new Date("2026-03-01T00:00:00Z"))).toBe("2029-04-15");
    expect(retentionUntil(2025, new Date("2026-10-01T00:00:00Z"))).toBe("2029-10-01");
  });
  it("accepts a five-digit PIN and rejects all zeros or wrong lengths", () => {
    expect(validateTaxpayerPin(" 12345 ")).toBe("12345");
    expect(() => validateTaxpayerPin("00000")).toThrow(/five digits/);
    expect(() => validateTaxpayerPin("1234")).toThrow(/five digits/);
  });
});

describe("creating an authorization", () => {
  it("refuses a prepared form that is not a PDF", async () => {
    await expect(createEfileAuthorization(mockDb().db, r2(), {
      firmId: "firm_1", clientId: "cli_1", userId: "u", formType: "8879", taxYear: 2025, taxpayerRole: "primary",
      taxpayerName: "Pat", formPdf: PNG,
    })).rejects.toThrow(/as a PDF/);
  });
  it("refuses a return from a different tax year", async () => {
    const { db } = mockDb((sql) => sql.startsWith("SELECT tax_year FROM tax_returns") ? [{ tax_year: 2024 }] : undefined);
    await expect(createEfileAuthorization(db, r2(), {
      firmId: "firm_1", clientId: "cli_1", userId: "u", formType: "8879", taxYear: 2025, taxReturnId: "ret_1",
      taxpayerRole: "primary", taxpayerName: "Pat", formPdf: await onePagePdf(),
    })).rejects.toThrow(/tax year 2024/);
  });
});

describe("in-person electronic signature", () => {
  it("seals the form with the signature, PIN and inspected ID, and stores a hash that matches the sealed file", async () => {
    const { db, statements } = mockDb(); const store = r2();
    store.objects.set("prepared.pdf", await onePagePdf());
    const result = await signInPerson(db, store, authorization(), {
      hostUserId: "staff_1", identity: photoId, userAgent: "tablet",
      signature: { signatureType: "drawn", signatureData: PNG_DATA_URL, signerName: "Pat Taxpayer", taxpayerPin: "24680" },
    });
    const sealed = store.objects.get(result.signedR2Key)!;
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(2);
    const evidence = statements.find((s) => s.query.includes("INSERT INTO efile_signature_evidence"))!;
    expect(evidence.params).toContain("in_person_esign");
    expect(evidence.params).toContain("24680");
    expect(JSON.parse(String(evidence.params![14]))).toMatchObject({ type: "photo_id_inspected", inspectedByUserId: "staff_1", ssnLast4: "6789" });
    const verify = mockDb((sql) => sql.includes("FROM efile_signature_evidence") ? [{ id: result.evidenceId, signed_hash: result.signedHash, signed_r2_key: result.signedR2Key }] : undefined);
    expect((await verifyEfileEvidence(verify.db, store, authorization())).intact).toBe(true);
  });

  it("stamps the signature where the preparer placed it on the form, and refuses a page that does not exist", async () => {
    const store = r2(); store.objects.set("prepared.pdf", await onePagePdf());
    const result = await signInPerson(mockDb().db, store, authorization(), {
      hostUserId: "staff_1", identity: photoId, userAgent: null, placement: { page: 0, xPct: 0.1, yPct: 0.8 },
      signature: { signatureType: "drawn", signatureData: PNG_DATA_URL, signerName: "Pat Taxpayer", taxpayerPin: "24680" },
    });
    expect((await PDFDocument.load(store.objects.get(result.signedR2Key)!)).getPageCount()).toBe(2);
    await expect(signInPerson(mockDb().db, store, authorization(), { hostUserId: "staff_1", identity: photoId, userAgent: null, placement: { page: 5, xPct: 0.1, yPct: 0.8 }, signature: typed }))
      .rejects.toThrow(/not on a page/);
  });

  it("detects a sealed file that was altered after signing", async () => {
    const store = r2(); store.objects.set("signed.pdf", new Uint8Array([1, 2, 3]));
    const { db } = mockDb((sql) => sql.includes("FROM efile_signature_evidence") ? [{ id: "ev", signed_hash: "0".repeat(64), signed_r2_key: "signed.pdf" }] : undefined);
    expect((await verifyEfileEvidence(db, store, authorization())).intact).toBe(false);
  });

  it("refuses the multi-year shortcut when no prior-year verified signing exists", async () => {
    const { db } = mockDb((sql) => sql.includes("ea.tax_year < $4") ? [] : undefined);
    await expect(signInPerson(db, r2(), authorization(), { hostUserId: "staff_1", identity: { mode: "multi_year" }, userAgent: null, signature: typed }))
      .rejects.toThrow(/No prior-year signing/);
  });

  it("refuses to sign an authorization that is already signed", async () => {
    await expect(signInPerson(mockDb().db, r2(), authorization({ status: "signed" }), { hostUserId: "staff_1", identity: photoId, userAgent: null, signature: typed }))
      .rejects.toThrow(/already signed/);
  });

  it("reports a conflict when the authorization was voided while sealing", async () => {
    const { db } = mockDb((sql) => sql.includes("WITH claimed AS") ? [] : undefined);
    const store = r2(); store.objects.set("prepared.pdf", await onePagePdf());
    await expect(signInPerson(db, store, authorization(), { hostUserId: "staff_1", identity: photoId, userAgent: null, signature: typed }))
      .rejects.toThrow(/already signed or voided/);
  });
});

describe("handwritten signatures", () => {
  it("wraps a photographed signed form into the sealed PDF with no identity check required", async () => {
    const store = r2(); store.objects.set("received.png", PNG);
    const received = authorization({ status: "handwritten_received", received_r2_key: "received.png", received_content_type: "image/png",
      received_hash: await sha256Hex(PNG.slice().buffer), received_ip: "203.0.113.9" });
    const { db, statements } = mockDb();
    const result = await acceptHandwrittenCopy(db, store, received, "staff_1");
    expect((await PDFDocument.load(store.objects.get(result.signedR2Key)!)).getPageCount()).toBe(2);
    const evidence = statements.find((s) => s.query.includes("INSERT INTO efile_signature_evidence"))!;
    expect(JSON.parse(String(evidence.params![14]))).toEqual({ type: "not_required_handwritten", reviewedByUserId: "staff_1" });
  });

  it("refuses a received copy whose bytes changed after upload", async () => {
    const store = r2(); store.objects.set("received.png", PNG);
    await expect(acceptHandwrittenCopy(mockDb().db, store, authorization({ status: "handwritten_received", received_r2_key: "received.png",
      received_content_type: "image/png", received_hash: "f".repeat(64) }), "staff_1")).rejects.toThrow(/integrity check/);
  });
});

describe("remote signing and identity verification", () => {
  it("stays off with no vendor, and with a vendor whose adapter is not connected", () => {
    expect(resolveKbaProvider({})).toMatchObject({ enabled: false, reason: expect.stringMatching(/No identity-verification vendor/) });
    expect(resolveKbaProvider({ EFILE_KBA_PROVIDER: "experian", EFILE_KBA_API_KEY: "k" })).toMatchObject({ enabled: false, reason: expect.stringMatching(/not connected/) });
  });

  it("turns on only for an implemented vendor with credentials", () => {
    const fake = { id: "experian", displayName: "Test vendor", implemented: true } as unknown as KbaProvider;
    expect(resolveKbaProvider({ EFILE_KBA_PROVIDER: "experian" }, { experian: fake })).toMatchObject({ enabled: false, reason: expect.stringMatching(/credentials/) });
    expect(resolveKbaProvider({ EFILE_KBA_PROVIDER: "experian", EFILE_KBA_API_KEY: "k" }, { experian: fake }).enabled).toBe(true);
  });

  it("blocks remote e-signing while no vendor is enabled", async () => {
    await expect(signRemotelyAfterKba(mockDb().db, r2(), authorization(), { signature: typed, signerLogin: "pat@example.com", ip: "203.0.113.9", userAgent: null }))
      .rejects.toMatchObject({ code: "KBA_PROVIDER_DISABLED" });
  });

  it("locks electronic signing after the third failed attempt", async () => {
    const { db } = mockDb();
    expect(await recordKbaAttempt(db, authorization({ kba_failed_attempts: 1 }), { provider: "experian", passed: false, providerReference: null }))
      .toMatchObject({ attemptsRemaining: 1, locked: false });
    expect(await recordKbaAttempt(db, authorization({ kba_failed_attempts: 2 }), { provider: "experian", passed: false, providerReference: null }))
      .toMatchObject({ attemptsRemaining: 0, locked: true });
    await expect(recordKbaAttempt(db, authorization({ kba_failed_attempts: 3 }), { provider: "experian", passed: true, providerReference: null }))
      .rejects.toMatchObject({ code: "KBA_LOCKED" });
  });
});

describe("transmission gate", () => {
  it("blocks a return with no Form 8879", async () => {
    await expect(assertReturnSigned(mockDb(() => []).db, "ret_1")).rejects.toMatchObject({ code: "EFILE_AUTHORIZATION_MISSING" });
  });
  it("blocks a joint return until the spouse signs too", async () => {
    const { db } = mockDb(() => [{ taxpayer_role: "primary", status: "signed" }, { taxpayer_role: "spouse", status: "awaiting_signature" }]);
    await expect(assertReturnSigned(db, "ret_1")).rejects.toThrow(/spouse/);
  });
  it("allows a return whose 8879s are all signed", async () => {
    await expect(assertReturnSigned(mockDb(() => [{ taxpayer_role: "primary", status: "signed" }]).db, "ret_1")).resolves.toBeUndefined();
  });
});
