import { describe, expect, it } from "vitest";
import { signDocumentToken, verifyDocumentToken } from "./signed-url";

const SECRET = "test-secret-at-least-32-characters-long";

describe("document download tokens", () => {
  it("round-trips an unrestricted token with scope 'all'", async () => {
    const token = await signDocumentToken(SECRET, "doc_1", Date.now() + 60_000);
    expect(await verifyDocumentToken(SECRET, "doc_1", token)).toBe("all");
  });

  it("round-trips a restricted token with scope 'unsigned'", async () => {
    const token = await signDocumentToken(SECRET, "doc_1", Date.now() + 60_000, "unsigned");
    expect(await verifyDocumentToken(SECRET, "doc_1", token)).toBe("unsigned");
  });

  it("cannot be upgraded from 'unsigned' to 'all' by editing the token", async () => {
    const token = await signDocumentToken(SECRET, "doc_1", Date.now() + 60_000, "unsigned");
    const [expiresAt, , sig] = token.split(".");
    expect(await verifyDocumentToken(SECRET, "doc_1", `${expiresAt}.${sig}`)).toBeNull();
  });

  it("rejects another document, an expired token, and a wrong secret", async () => {
    const token = await signDocumentToken(SECRET, "doc_1", Date.now() + 60_000);
    expect(await verifyDocumentToken(SECRET, "doc_2", token)).toBeNull();
    expect(await verifyDocumentToken(SECRET, "doc_1", await signDocumentToken(SECRET, "doc_1", Date.now() - 1))).toBeNull();
    expect(await verifyDocumentToken("another-secret-at-least-32-characters", "doc_1", token)).toBeNull();
  });
});
