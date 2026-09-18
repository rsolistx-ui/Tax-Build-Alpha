import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireOwner } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { AdminRulesService } from "../services/admin-rules";

export const adminRulesRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
adminRulesRoutes.use("*", requireSession);
adminRulesRoutes.use("*", requireOwner);

const createRuleSchema = z.object({
  title: z.string().min(1).max(200),
  markdownContent: z.string().min(1),
  ruleType: z.enum(["categorization", "personal_vs_business", "tax_deduction", "general"]).default("categorization"),
  clientId: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  priority: z.number().int().default(0),
  effectiveFrom: z.string().nullable().optional(),
  dictatedPrompt: z.string().nullable().optional(),
});

const updateRuleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  markdownContent: z.string().min(1).optional(),
  ruleType: z.enum(["categorization", "personal_vs_business", "tax_deduction", "general"]).optional(),
  clientId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().optional(),
  effectiveFrom: z.string().nullable().optional(),
  dictatedPrompt: z.string().nullable().optional(),
});

const dictateSchema = z.object({
  dictatedText: z.string().min(3),
  clientId: z.string().nullable().optional(),
  clientName: z.string().optional(),
  entityType: z.string().optional(),
  industry: z.string().optional(),
});

const testRuleSchema = z.object({
  merchant: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().optional(),
  rulesMarkdown: z.string().optional(),
  clientId: z.string().nullable().optional(),
});

// List rules
adminRulesRoutes.get("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const clientId = c.req.query("clientId");

  const service = new AdminRulesService(db);
  const rules = await service.listRules(firm.id, clientId);
  return c.json({ rules });
});

// Dictate / Speak rule in natural language and compile with AI
adminRulesRoutes.post("/dictate", async (c) => {
  const body = dictateSchema.parse(await c.req.json());
  const db = createDb(c.env);
  const service = new AdminRulesService(db);

  const result = await service.compileDictatedRule(c.env, body);
  return c.json({ result });
});

// Get single rule
adminRulesRoutes.get("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const ruleId = c.req.param("id");

  const service = new AdminRulesService(db);
  const rule = await service.getRule(firm.id, ruleId);
  if (!rule) return c.json({ error: "Rule not found" }, 404);
  return c.json({ rule });
});

// Create rule
adminRulesRoutes.post("/", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = createRuleSchema.parse(await c.req.json());

  const service = new AdminRulesService(db);
  const rule = await service.createRule(firm.id, {
    title: body.title,
    markdownContent: body.markdownContent,
    ruleType: body.ruleType,
    clientId: body.clientId,
    isActive: body.isActive,
    priority: body.priority,
    effectiveFrom: body.effectiveFrom,
    dictatedPrompt: body.dictatedPrompt,
    createdByUserId: c.get("userId"),
  });

  return c.json({ rule }, 201);
});

// Update rule
adminRulesRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const ruleId = c.req.param("id");
  const body = updateRuleSchema.parse(await c.req.json());

  const service = new AdminRulesService(db);
  const rule = await service.updateRule(firm.id, ruleId, body);
  if (!rule) return c.json({ error: "Rule not found" }, 404);
  return c.json({ rule });
});

// Delete rule
adminRulesRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const ruleId = c.req.param("id");

  const service = new AdminRulesService(db);
  const deleted = await service.deleteRule(firm.id, ruleId);
  if (!deleted) return c.json({ error: "Rule not found" }, 404);
  return c.json({ ok: true });
});

// Apply rule retroactively to unreviewed receipts on or after effectiveFrom
adminRulesRoutes.post("/:id/apply-retroactive", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const ruleId = c.req.param("id");

  const service = new AdminRulesService(db);
  const result = await service.applyRuleRetroactively(firm.id, ruleId);
  return c.json({ result });
});

// Interactive Simulator: Test purchase against rules
adminRulesRoutes.post("/test", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const body = testRuleSchema.parse(await c.req.json());

  const service = new AdminRulesService(db);
  let rulesMarkdown = body.rulesMarkdown;

  // If rulesMarkdown not passed in directly, compile active stored rules
  if (!rulesMarkdown) {
    rulesMarkdown = await service.compileActiveRulesMarkdown(firm.id, body.clientId);
  }

  const result = await service.testRuleMatching(c.env, {
    merchant: body.merchant,
    description: body.description,
    amount: body.amount,
    rulesMarkdown: rulesMarkdown || "Standard IRS Schedule C Expense Rules",
  });

  return c.json({ result });
});
