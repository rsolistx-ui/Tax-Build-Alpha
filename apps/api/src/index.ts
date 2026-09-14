import { Hono } from "hono";
import { formatErrorResponse } from "./services/errors";
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
import { requireActiveBeta } from "./middleware/beta";
import { ensureFirm } from "./services/firm";
import { betaRoutes } from "./routes/beta";
import { internalRoutes } from "./routes/internal";
import { reportRoutes } from "./routes/reports";
import { dashboardRoutes } from "./routes/dashboard";
import { workspaceRoutes } from "./routes/workspace";
import { documentReviewRoutes } from "./routes/document-review";
import { engagementRoutes } from "./routes/engagements";
import { workQueueRoutes } from "./routes/work-queue";
import { clientRequestRoutes } from "./routes/client-requests";
import { portalRoutes } from "./routes/portal";
import { agentSupervisorRoutes, agentDeskRoutes } from "./routes/agent-supervisor";
import { taxAdjustmentRoutes } from "./routes/tax-adjustment";
import { taxWorkpaperRoutes } from "./routes/tax-workpapers";
import { taxOrganizerRoutes } from "./routes/tax-organizer";
import { taxExtendedRoutes } from "./routes/tax-extended";
import { docVersioningRoutes } from "./routes/doc-versioning";
import { taxWorkbenchRoutes } from "./routes/tax-workbench";
import { returnEngineRoutes } from "./routes/return-engine";

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
     allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

/**
 * Security headers applied to every response. The CSP is intentionally
 * narrow: only 'self' for scripts and connections, Google Fonts is the one
 * named third-party origin (already the app's only external dependency),
 * and object-src/frame-ancestors/base-uri are locked down entirely. This
 * covers the same-origin SPA+API Worker, the PWA, and the Tauri desktop
 * webview equally since all three load this exact origin.
 */
app.use("*", async (c, next) => {
  await next();
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("X-Frame-Options", "DENY");
});

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

app.get("/api/me", requireSession, requireActiveBeta, async (c) => {
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
app.route("/api/clients", reportRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/clients", workspaceRoutes);
app.route("/api/documents", documentReviewRoutes);
app.route("/api/clients", engagementRoutes);
app.route("/api/clients", clientRequestRoutes);
app.route("/api/work-queue", workQueueRoutes);
app.route("/api/portal", portalRoutes);
app.route("/api/agent-tasks", agentDeskRoutes);
app.route("/api/clients", agentSupervisorRoutes);
app.route("/api/clients", taxAdjustmentRoutes);
app.route("/api/clients", taxWorkpaperRoutes);
app.route("/api/clients", taxOrganizerRoutes);
app.route("/api/clients", taxExtendedRoutes);
app.route("/api/clients", docVersioningRoutes);
app.route("/api/clients", taxWorkbenchRoutes);
app.route("/api/clients", returnEngineRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  const requestId = crypto.randomUUID();
  // Full detail (which can include SQL text, connection hosts, or other
  // infrastructure specifics) is logged server-side only, keyed by
  // requestId. formatErrorResponse never places anything from `err` itself
  // into the response body.
  console.error(`[${requestId}]`, err);
  const { status, body } = formatErrorResponse(err, requestId);
  return c.json(body, status);
});

export default app;
