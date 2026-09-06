import { describe, expect, it } from "vitest";
import { buildInvitationLink, parseInvitationFragment } from "@/lib/beta";

describe("buildInvitationLink", () => {
  it("places the token and email in the URL fragment, never the query string", () => {
    const link = buildInvitationLink("https://folio-api.rsolistx.workers.dev", "secret-token-123", "phyllis@example.com");
    const url = new URL(link);
    expect(url.search).toBe("");
    expect(link).not.toContain("?token=");
    expect(link).not.toContain("&token=");
    expect(url.hash).toContain("token=secret-token-123");
    expect(url.hash).toContain(encodeURIComponent("phyllis@example.com"));
  });

  it("URL-encodes special characters in the token and email", () => {
    const link = buildInvitationLink("https://folio-api.rsolistx.workers.dev", "abc+def/ghi=", "a+b@example.com");
    expect(link).not.toContain("abc+def/ghi=&");
    const parsed = parseInvitationFragment(new URL(link).hash);
    expect(parsed.token).toBe("abc+def/ghi=");
    expect(parsed.email).toBe("a+b@example.com");
  });
});

describe("parseInvitationFragment", () => {
  it("extracts token and email from a fragment string with a leading #", () => {
    const parsed = parseInvitationFragment("#token=abc123&email=phyllis%40example.com");
    expect(parsed.token).toBe("abc123");
    expect(parsed.email).toBe("phyllis@example.com");
  });

  it("extracts token and email from a fragment string without a leading #", () => {
    const parsed = parseInvitationFragment("token=abc123&email=phyllis%40example.com");
    expect(parsed.token).toBe("abc123");
    expect(parsed.email).toBe("phyllis@example.com");
  });

  it("returns null for missing fields", () => {
    const parsed = parseInvitationFragment("#");
    expect(parsed.token).toBeNull();
    expect(parsed.email).toBeNull();
  });
});
