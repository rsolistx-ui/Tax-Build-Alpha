import { createDb } from "../db";
import { runConsentOutreach } from "./consent-outreach";
import { runSignatureReminders } from "./signature-reminders";
import type { Env } from "../env";
import { ReliabilityEngineerService } from "./reliability-engineer";
import { handleReminderCron } from "./reminders";
import { TelegramNotifierService } from "./telegram-notifier";
import { prepareMorningBrief } from "./morning-brief";
import { WorkflowTemplateService } from "./workflow-templates";

export type ScheduledOperationsResult = {
  ranAt: string;
  remindersSent: number;
  firmsWithReminders: number;
  diagnosticsHealthy: boolean;
  pendingProfessionalReviews: number;
  morningRecommendationsCreated: number;
  workflowSubscriptionsProcessed: number;
  workflowWorkItemsCreated: number;
  notification: "sent" | "not_configured" | "failed";
};

/**
 * A deliberately bounded weekday operations run. It performs only reversible,
 * evidence-preserving work: reminders already due, diagnostics, and a count
 * of work awaiting a professional. It never files, classifies, changes books,
 * or sends a client-facing message without the existing request workflow.
 */
export async function runScheduledOperations(env: Env): Promise<ScheduledOperationsResult> {
  const db = createDb(env);
  const [reminders, diagnostics, firms, pending] = await Promise.all([
    handleReminderCron(env),
    new ReliabilityEngineerService(db, env).runDiagnostics(),
    // A firm with no members was left by an owner who joined another firm; nothing to brief.
    db.query<{ id: string }>(`SELECT id FROM firms f WHERE EXISTS (SELECT 1 FROM firm_members m WHERE m.firm_id = f.id)`),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM agent_tasks WHERE status = 'awaiting_approval'`,
    ),
  ]);
  const morningBriefs = await Promise.all(firms.map((firm) => prepareMorningBrief(db, firm.id)));
  const morningRecommendationsCreated = morningBriefs.reduce((total, brief) => total + brief.recommendationsCreated, 0);
  const workflowSummary = await new WorkflowTemplateService(db).runDueSubscriptions();
  // IRC § 7216 consent links go out on their own; a failure here never blocks the rest of the morning run.
  const consentOutreach = await runConsentOutreach(db, env).catch((error) => { console.error("consent outreach failed", error); return null; });
  const signatureReminders = await runSignatureReminders(db, env).catch((error) => { console.error("signature reminders failed", error); return null; });
  if (signatureReminders) console.log(`8879 reminders: sent ${signatureReminders.sent}${signatureReminders.skipped ? ` (${signatureReminders.skipped})` : ""}`);
  if (consentOutreach) console.log(`consent outreach: ${consentOutreach.status}, sent ${consentOutreach.sent}, waiting ${consentOutreach.waiting}`);

  const pendingProfessionalReviews = Number(pending[0]?.count ?? 0);
  const notifier = new TelegramNotifierService(env);
  const configured = Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHAT_ID?.trim());
  const status = await notifier.notifySystemHealth({
    healthy: diagnostics.overallHealthy,
    details: `Weekday operations completed. ${reminders.remindersSent} reminder${reminders.remindersSent === 1 ? "" : "s"} staged; ${morningRecommendationsCreated} new review recommendation${morningRecommendationsCreated === 1 ? "" : "s"}; ${pendingProfessionalReviews} item${pendingProfessionalReviews === 1 ? "" : "s"} awaiting professional review.`,
    latencyMs: diagnostics.checks.postgres.latencyMs,
  });

  return {
    ranAt: new Date().toISOString(),
    remindersSent: reminders.remindersSent,
    firmsWithReminders: reminders.firms,
    diagnosticsHealthy: diagnostics.overallHealthy,
    pendingProfessionalReviews,
    morningRecommendationsCreated,
    workflowSubscriptionsProcessed: workflowSummary.subscriptionsProcessed,
    workflowWorkItemsCreated: workflowSummary.workItemsCreated,
    notification: !configured ? "not_configured" : status.success ? "sent" : "failed",
  };
}
