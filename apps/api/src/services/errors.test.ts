import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { formatErrorResponse } from "./errors";

describe("formatErrorResponse", () => {
  it("never includes the original error message, even one containing an obvious fake secret", () => {
    const fakeSecret = "sk_live_FAKE_SECRET_1234567890abcdef";
    const err = new Error(
      `Neon query failed (400): connection to postgres://user:${fakeSecret}@ep-fake-host.neon.tech/db failed`,
    );
    const { status, body } = formatErrorResponse(err, "req_test_1");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fakeSecret);
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("neon.tech");
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error", code: "INTERNAL_ERROR", requestId: "req_test_1" });
  });

  it("never includes a stack trace", () => {
    const err = new Error("boom");
    const { body } = formatErrorResponse(err, "req_test_2");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("at ");
    expect(serialized).not.toContain(".ts:");
  });

  it("returns a safe, structured response for a non-Error throw value", () => {
    const { status, body } = formatErrorResponse("a plain string secret DATABASE_URL=postgres://x", "req_test_3");
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });

  it("returns structured validation issues (safe) for a ZodError, not the raw exception string", () => {
    const schema = z.object({ email: z.string().email() });
    let zodError: ZodError;
    try {
      schema.parse({ email: "not-an-email" });
      throw new Error("expected parse to throw");
    } catch (e) {
      zodError = e as ZodError;
    }
    const { status, body } = formatErrorResponse(zodError, "req_test_4");
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("includes the provided requestId so the safe response can be correlated with the server log", () => {
    const { body } = formatErrorResponse(new Error("anything"), "req_test_5");
    expect(body.requestId).toBe("req_test_5");
  });
});
