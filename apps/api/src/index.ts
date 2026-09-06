import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDb } from "./db";
import type { Env } from "./env";
import { createAuth } from "./auth";
import { clientRoutes } from "./routes/clients";
import { categoryRoutes } from "./routes/categories";
import { receiptRoutes } from "./routes/receipts";
import { pnlRoutes } from "./routes/pnl";
import { bankRoutes } from "./routes/bank";
import { requireSession, type AuthedVars } from "./middleware/session";
import { ensureFirm } from "./services/firm";
import { betaRoutes } from "./routes/beta";
import { internalRoutes } from "./routes/internal";

const app = new Hono<{ Bindings: Env; Variables: AuthedVars }>();

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = new Set([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        c.env.APP_ORIGIN,
      ].filter(Boolean));
      return allowed.has(origin) ? origin : c.env.APP_ORIGIN || "http://localhost:5173";
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "folio-api",
    appDatabase: c.env.DATABASE_URL ? "neon-postgres" : "missing",
    authDatabase: "cloudflare-d1",
    llm: c.env.LLM_PROVIDER || "workers-ai",
    workersAi: Boolean(c.env.AI),
    queues: Boolean(c.env.JOBS_QUEUE),
  }),
);

// Public registration is closed: Folio is invitation-only during the beta.
// This specific route is registered before the wildcard below, so Hono
// matches it first and Better Auth's own sign-up endpoint never runs for a
// direct caller. The only path that creates an account is POST
// /api/beta/redeem, which calls auth.api.signUpEmail() as a direct method
// call (not an HTTP route match), so it is unaffected by this block.
app.post("/api/auth/sign-up/email", (c) =>
  c.json({ error: "Registration requires a beta invitation.", code: "BETA_REQUIRED" }, 403),
);
app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.route("/api/beta", betaRoutes);
app.route("/api/internal", internalRoutes);

app.get("/api/me", requireSession, async (c) => {
  const firm = await ensureFirm(createDb(c.env), c.get("userId"), c.get("userName"));
  return c.json({
    user: {
      id: c.get("userId"),
      email: c.get("userEmail"),
      name: c.get("userName"),
    },
    firm,
  });
});

app.route("/api/clients", clientRoutes);
app.route("/api/clients", categoryRoutes);
app.route("/api/clients", receiptRoutes);
app.route("/api/clients", pnlRoutes);
app.route("/api/clients", bankRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  const message = err instanceof Error ? err.message : "Internal error";
  if (message.includes("ZodError") || err?.name === "ZodError") {
    return c.json({ error: "Validation failed", detail: message }, 400);
  }
  return c.json({ error: message }, 500);
});

export default app;
