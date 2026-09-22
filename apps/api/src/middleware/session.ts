import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { createAuth } from "../auth";

export type AuthedVars = {
  userId: string;
  userEmail: string;
  userName: string;
};

export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: AuthedVars;
}>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user) {
    c.set("userId", session.user.id);
    c.set("userEmail", session.user.email);
    c.set("userName", session.user.name);
    await next();
    return;
  }

  return c.json({ error: "Unauthorized" }, 401);
});
