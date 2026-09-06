import { ZodError } from "zod";

/**
 * Formats any thrown error into a safe production response body. Nothing
 * from the original error - message text, stack trace, or cause - is ever
 * included: a financial beta must never leak a raw SQL error, a Postgres
 * host, a Cloudflare/Better Auth secret, an AI provider detail, or any
 * other infrastructure specific to the client. The full error belongs only
 * in the server-side log, correlated by requestId.
 */
export function formatErrorResponse(
  err: unknown,
  requestId: string,
): { status: 400 | 500; body: Record<string, unknown> } {
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        requestId,
        issues: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    };
  }
  return {
    status: 500,
    body: { error: "Internal server error", code: "INTERNAL_ERROR", requestId },
  };
}
