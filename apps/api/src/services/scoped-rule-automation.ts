import type { Db } from "../db";
import type { Env } from "../env";
import { AdminRulesService, type RuleType } from "./admin-rules";

export type ScopedRuleAutomationResult =
  | { status: "activated"; ruleId: string; summary: string }
  | { status: "review_required"; reason: string };

/**
 * Turns a practitioner request into a narrowly-scoped intake rule. It is
 * deliberately not a source-code executor: the result is a firm_rules record
 * bound to one verified client and affects future suggestions only. Tax
 * conclusions, firm-wide rules, and retroactive changes remain review-gated.
 */
export async function activateSafeScopedRule(input: {
  db: Db;
  env: Env;
  firmId: string;
  clientId: string | undefined;
  clientName?: string;
  directiveText: string;
  ruleType: RuleType;
  actorUserId: string;
}): Promise<ScopedRuleAutomationResult> {
  if (!input.clientId) {
    return { status: "review_required", reason: "Choose a client before activating a rule automatically." };
  }
  if (input.ruleType === "tax_deduction") {
    return { status: "review_required", reason: "Tax-treatment directives require practitioner review before activation." };
  }

  const [client] = await input.db.query<{ id: string }>(
    `SELECT id FROM clients WHERE id = $1 AND firm_id = $2`,
    [input.clientId, input.firmId],
  );
  if (!client) {
    return { status: "review_required", reason: "The selected client is not part of this firm." };
  }

  const rules = new AdminRulesService(input.db);
  const compiled = await rules.compileDictatedRule(input.env, {
    dictatedText: input.directiveText,
    clientName: input.clientName,
  });
  if (!compiled.auditPassed) {
    return { status: "review_required", reason: compiled.auditNotes.join(" ") || "The proposed rule did not pass validation." };
  }

  const rule = await rules.createRule(input.firmId, {
    title: compiled.title,
    markdownContent: compiled.markdownContent,
    ruleType: input.ruleType,
    clientId: input.clientId,
    isActive: true,
    priority: 50,
    dictatedPrompt: input.directiveText,
    createdByUserId: input.actorUserId,
  });

  return { status: "activated", ruleId: rule.id, summary: compiled.explanation };
}
