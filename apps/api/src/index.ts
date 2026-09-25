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
import { adminRoutes } from "./routes/admin";
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
import { agentSchedulerRoutes } from "./routes/agent-scheduler";
import { taxAdjustmentRoutes } from "./routes/tax-adjustment";
import { taxWorkpaperRoutes } from "./routes/tax-workpapers";
import { taxOrganizerRoutes } from "./routes/tax-organizer";
import { taxExtendedRoutes } from "./routes/tax-extended";
import { docVersioningRoutes } from "./routes/doc-versioning";
import { publicSigningRoutes } from "./routes/public-signing";
import { efileSignatureRoutes, publicEfileSigningRoutes } from "./routes/efile-signature";
import { consentRoutes, publicConsentRoutes } from "./routes/taxpayer-consent";
import { taxPlanningRoutes } from "./routes/tax-planning";
import { agreementRoutes } from "./routes/agreement";
import { signedDocumentRoutes } from "./routes/signed-documents";
import { engagementLetterRoutes } from "./routes/engagement-letters";
import { taxWorkbenchRoutes, workbenchListRoutes } from "./routes/tax-workbench";
import { returnEngineRoutes } from "./routes/return-engine";
import { taxHandoffRoutes } from "./routes/tax-handoff";
import { firmJoinRoutes, firmStaffRoutes } from "./routes/firm-staff";
import { docuSignRoutes } from "./routes/docu-sign";
import { gmailRoutes } from "./routes/gmail";
import { gmailOAuthRoutes } from "./routes/gmail-oauth";
import { billingRoutes } from "./routes/billing";
import { timeEntryRoutes } from "./routes/time-entries";
import { workflowTemplateRoutes } from "./routes/workflow-templates";
import { deadlineCalendarRoutes } from "./routes/deadline-calendar";
import { quickbooksRoutes } from "./routes/quickbooks";
import { accountingRoutes } from "./routes/accounting";
import { stripeRoutes } from "./routes/stripe";
import { stripeOAuthRoutes } from "./routes/stripe-oauth";
import { googleCalendarRoutes } from "./routes/google-calendar";
import { waveImportRoutes } from "./routes/wave-import";
import { estimatesRoutes } from "./routes/estimates";
import { projectsRoutes } from "./routes/projects";
import { adminRulesRoutes } from "./routes/admin-rules";
import { taxRadarAdvisoryRoutes } from "./routes/tax-radar-advisory";
import { featureRequestRoutes } from "./routes/feature-requests";
import { timeSavingsRoutes } from "./routes/time-savings";
import { systemReliabilityRoutes } from "./routes/system-reliability";
import { bankConnectivityRoutes, bankWebhookRoutes } from "./routes/bank-connectivity";
import { supportRoutes } from "./routes/support";
import { difAuditRoutes } from "./routes/dif-audit";
import { taxAdvisoryRoutes } from "./routes/tax-advisory";
import { intercompanyRoutes } from "./routes/intercompany";
import { directUploadSmsRoutes } from "./routes/direct-upload-sms";
import { turnstileRoutes } from "./routes/turnstile";
import { adminUnlockRoutes } from "./routes/admin-unlock";
import { runScheduledOperations } from "./services/scheduled-operations";
import { runSupervisorHeartbeat } from "./services/supervisor-heartbeat";
import { runBankFeedHeartbeat } from "./services/bank-feed-heartbeat";

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
    // The token is accepted only by owner routes after a real session check;
    // listing it here permits the browser's preflight without making it a
    // substitute for authentication.
    allowHeaders: ["Content-Type", "Authorization", "X-Admin-Token"],
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
      "script-src 'self' https://challenges.cloudflare.com https://cdn.plaid.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://cdn.plaid.com",
      "frame-src 'self' https://challenges.cloudflare.com https://cdn.plaid.com",
      "connect-src 'self' https://challenges.cloudflare.com",
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
app.route("/api/auth/turnstile", turnstileRoutes);
app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.route("/api/beta", betaRoutes);
app.route("/api/admin-unlock", adminUnlockRoutes);
app.route("/api/admin", adminRoutes);
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

// Every sub-app below is mounted at /api/clients, and a sub-app's use("*")
// applies to the whole prefix, so per-file session/beta middleware ran once
// per sub-app (25 session lookups per request). Gate the prefix exactly once.
app.use("/api/clients/*", requireSession, requireActiveBeta);
app.route("/api/clients", clientRoutes);
app.route("/api/clients", categoryRoutes);
app.route("/api/clients", receiptRoutes);
app.route("/api/clients", pnlRoutes);
app.route("/api/clients", bankRoutes);
app.route("/api/clients", reportRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/clients", workspaceRoutes);
app.route("/api/documents", documentReviewRoutes);
app.route("/api/signed-documents", signedDocumentRoutes);
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
app.route("/api/signing/efile", publicEfileSigningRoutes);
app.route("/api/signing", publicSigningRoutes);
app.route("/api/clients", efileSignatureRoutes);
app.route("/api/clients", consentRoutes);
app.route("/api/consent", publicConsentRoutes);
app.route("/api/clients", taxPlanningRoutes);
app.route("/api/agreement", agreementRoutes);
app.route("/api/clients", engagementLetterRoutes);
app.route("/api/clients", taxWorkbenchRoutes);
app.route("/api/workbench", workbenchListRoutes);
app.route("/api/firm", firmStaffRoutes);
app.route("/api/firm-join", firmJoinRoutes);
app.route("/api/clients", returnEngineRoutes);
app.route("/api/clients", taxHandoffRoutes);
import { pushRoutes } from "./routes/push";
import { feedbackRoutes } from "./routes/feedback";
app.route("/api/docu-sign", docuSignRoutes);
app.route("/api/gmail/oauth", gmailOAuthRoutes);
app.route("/api/gmail", gmailRoutes);
app.route("/api/billing", billingRoutes);
app.route("/api/time-entries", timeEntryRoutes);
app.route("/api/workflow-templates", workflowTemplateRoutes);
app.route("/api/calendar", deadlineCalendarRoutes);
app.route("/api/quickbooks", quickbooksRoutes);
app.route("/api/accounting", accountingRoutes);
app.route("/api/stripe/oauth", stripeOAuthRoutes);
app.route("/api/stripe", stripeRoutes);
app.route("/api/google-calendar", googleCalendarRoutes);
app.route("/api/wave-import", waveImportRoutes);
app.route("/api/estimates", estimatesRoutes);
app.route("/api/projects", projectsRoutes);
app.route("/api/agent-schedule", agentSchedulerRoutes);
app.route("/api/feedback", feedbackRoutes);
app.route("/api/push", pushRoutes);
app.route("/api/admin/rules", adminRulesRoutes);
app.route("/api/clients", taxRadarAdvisoryRoutes);
app.route("/api/feature-requests", featureRequestRoutes);
app.route("/api/time-savings", timeSavingsRoutes);
app.route("/api/system", systemReliabilityRoutes);
app.route("/api/bank-connectivity/webhooks", bankWebhookRoutes);
app.route("/api/bank-connectivity", bankConnectivityRoutes);
app.route("/api/support", supportRoutes);
app.route("/api/clients", difAuditRoutes);
app.route("/api/clients", taxAdvisoryRoutes);
app.route("/api/clients", intercompanyRoutes);
app.route("/api/clients", directUploadSmsRoutes);
app.route("/api", directUploadSmsRoutes);

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

const worker = Object.assign(app, {
  scheduled(controller: ScheduledController, env: Env, executionCtx: ExecutionContext) {
    const operation = controller.cron === "*/30 * * * *"
      ? Promise.allSettled([runSupervisorHeartbeat(env), runBankFeedHeartbeat(env)]).then((results) => {
          for (const result of results) {
            if (result.status === "rejected") console.error("[scheduled-half-hourly] task failed", result.reason);
          }
        })
      : runScheduledOperations(env);
    executionCtx.waitUntil(
      operation.catch((error) => {
        console.error("[scheduled-operations]", { cron: controller.cron, error });
      }),
    );
  },
});

export default worker;
