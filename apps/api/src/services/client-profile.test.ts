import { describe, expect, it } from "vitest";
import { validateProfileInput, mergeProfile, ALLOWED_PROFILE_FIELDS } from "./client-profile";

describe("validateProfileInput", () => {
  it("accepts every allow-listed field", () => {
    const input = Object.fromEntries(ALLOWED_PROFILE_FIELDS.map((f) => [f, f === "contactEmail" ? "phyllis@example.com" : f === "einLast4" ? "1234" : "value"]));
    const result = validateProfileInput(input);
    expect(result.ok).toBe(true);
  });

  it("rejects a field that looks like a full SSN request", () => {
    const result = validateProfileInput({ ssn: "123-45-6789" });
    expect(result.ok).toBe(false);
  });

  it("rejects a field that looks like bank credentials", () => {
    const result = validateProfileInput({ bankPassword: "hunter2" });
    expect(result.ok).toBe(false);
  });

  it("rejects a field that looks like a full account number", () => {
    const result = validateProfileInput({ fullAccountNumber: "0001112223" });
    expect(result.ok).toBe(false);
  });

  it("silently drops unknown, non-sensitive fields", () => {
    const result = validateProfileInput({ favoriteColor: "blue" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sanitized).toEqual({});
  });

  it("rejects an einLast4 longer than 4 digits", () => {
    const result = validateProfileInput({ einLast4: "123456" });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid einLast4", () => {
    const result = validateProfileInput({ einLast4: "1234" });
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid contact email", () => {
    const result = validateProfileInput({ contactEmail: "not-an-email" });
    expect(result.ok).toBe(false);
  });
});

describe("mergeProfile", () => {
  it("merges incoming fields over existing ones without dropping untouched fields", () => {
    const merged = mergeProfile({ notes: "old", dba: "Old DBA" }, { notes: "new" });
    expect(merged).toEqual({ notes: "new", dba: "Old DBA" });
  });
});
