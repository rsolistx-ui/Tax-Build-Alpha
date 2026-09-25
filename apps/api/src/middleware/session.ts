import { createMiddleware } from "hono/factory";
import type { FirmRole } from "../services/firm-roles";
import type { Env } from "../env";
import { createAuth } from "../auth";

export type AuthedVars = {
  userId: string;
  userEmail: string;
  userName: string;
  /** Set by requireActiveBeta. Unset means the gate did not run; readers treat that as read_only. */
  firmRole?: FirmRole;
  /** Set by requireActiveBeta: the user id when the caller only sees assigned clients, else null. */
  clientScopeUserId?: string | null;
};

export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: AuthedVars;
}>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user) {
    // 16 CFR 314.4(c)(5): once enforcement is on, an account without a second factor gets no data.
    if (c.env.REQUIRE_MFA === "true" && !(session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) {
      return c.json({ error: "Set up two-step sign-in to continue.", code: "MFA_ENROLLMENT_REQUIRED" }, 403);
    }
    c.set("userId", session.user.id);
    c.set("userEmail", session.user.email);
    c.set("userName", session.user.name);
    await next();
    return;
  }

  return c.json({ error: "Unauthorized" }, 401);
});
