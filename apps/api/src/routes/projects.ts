import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { getEngagement } from "../services/engagements";
import { ProjectsService } from "../services/projects";

export const projectsRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
projectsRoutes.use("*", requireSession);
projectsRoutes.use("*", requireActiveBeta);

const transactionTypeSchema = z.enum([
  "bank_transaction",
  "invoice",
  "estimate",
  "receipt",
  "payment",
  "journal_entry",
]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createProjectSchema = z.object({
  engagementId: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]).default("active"),
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  budgetAmount: z.number().positive().nullable().optional(),
  budgetCurrency: z.string().length(3).default("USD"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#3B82F6"),
  isBillable: z.boolean().default(true),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(),
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  budgetAmount: z.number().positive().nullable().optional(),
  budgetCurrency: z.string().length(3).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  isBillable: z.boolean().optional(),
});

const createTagSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#6B7280"),
});

const updateTagSchema = createTagSchema.partial();

const tagTransactionSchema = z.object({
  transactionId: z.string().min(1),
  transactionType: transactionTypeSchema,
  tagId: z.string().min(1),
});

const autoTagRuleSchema = z.object({
  projectId: z.string().min(1),
  tagId: z.string().min(1),
  ruleType: z.enum(["merchant", "category", "description", "amount_range"]),
  matchValue: z.string().min(1).max(500),
  matchOperator: z
    .enum(["equals", "contains", "starts_with", "ends_with", "regex", "between"])
    .default("contains"),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

const updateAutoTagRuleSchema = autoTagRuleSchema
  .omit({ projectId: true, tagId: true, ruleType: true, matchValue: true })
  .partial();

const budgetSnapshotSchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
  budgetRevenue: z.number().min(0),
  budgetExpenses: z.number().min(0),
});

const pnlQuerySchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
});

// ============ Projects ============

// Create project
projectsRoutes.post("/:clientId/projects", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = createProjectSchema.parse(await c.req.json());

  if (body.engagementId) {
    const engagement = await getEngagement(db, body.engagementId, firm.id);
    if (!engagement || engagement.client_id !== client.id) {
      return c.json({ error: "Engagement not found for this client" }, 404);
    }
  }

  const service = new ProjectsService(db);
  const project = await service.createProject(firm.id, {
    clientId: client.id,
    engagementId: body.engagementId ?? null,
    name: body.name,
    description: body.description,
    status: body.status,
    startDate: body.startDate,
    endDate: body.endDate,
    budgetAmount: body.budgetAmount,
    budgetCurrency: body.budgetCurrency,
    color: body.color,
    isBillable: body.isBillable,
  });

  return c.json({ project }, 201);
});

// List projects for a client
projectsRoutes.get("/:clientId/projects", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new ProjectsService(db);
  const projects = await service.getProjectsByClient(client.id);

  return c.json({ projects });
});

// List all projects for firm (with filters)
projectsRoutes.get("/projects", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z
    .object({
      status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(),
      clientId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).default(50),
      offset: z.coerce.number().int().nonnegative().default(0),
    })
    .parse(c.req.query());

  const service = new ProjectsService(db);
  const projects = await service.getProjectsByFirm(firm.id, {
    status: query.status,
    clientId: query.clientId,
  });

  return c.json({ projects: projects.slice(query.offset, query.offset + query.limit) });
});

// Firm-wide P&L summary across every project for the period.
projectsRoutes.get("/pnl/summary", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = pnlQuerySchema.parse(c.req.query());

  const service = new ProjectsService(db);
  const projects = await service.getProjectsByFirm(firm.id);
  const pnls = [];
  for (const project of projects) {
    const pnl = await service.getProjectPnL(project.id, query.periodStart, query.periodEnd);
    if (pnl) pnls.push(pnl);
  }

  const totals = pnls.reduce(
    (acc, p) => ({
      revenue: acc.revenue + p.revenue,
      expenses: acc.expenses + p.expenses,
      netIncome: acc.netIncome + p.netIncome,
      budgetRevenue: acc.budgetRevenue + p.budgetRevenue,
      budgetExpenses: acc.budgetExpenses + p.budgetExpenses,
    }),
    { revenue: 0, expenses: 0, netIncome: 0, budgetRevenue: 0, budgetExpenses: 0 },
  );

  return c.json({ periodStart: query.periodStart, periodEnd: query.periodEnd, projects: pnls, totals });
});

// Get project with tags
projectsRoutes.get("/:clientId/projects/:projectId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const tags = await service.getTagsByProject(project.id);

  return c.json({ project, tags });
});

// Update project
projectsRoutes.patch("/:clientId/projects/:projectId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = updateProjectSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const updated = await service.updateProject(project.id, body);
  return c.json({ project: updated });
});

// Delete project
projectsRoutes.delete("/:clientId/projects/:projectId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  await service.deleteProject(project.id);
  return c.json({ ok: true });
});

// ============ Tags ============

// Create tag
projectsRoutes.post("/:clientId/projects/:projectId/tags", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = createTagSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const tag = await service.createTag(project.id, body.name, body.color);
  return c.json({ tag }, 201);
});

// List tags
projectsRoutes.get("/:clientId/projects/:projectId/tags", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const tags = await service.getTagsByProject(project.id);
  return c.json({ tags });
});

// Update tag
projectsRoutes.patch("/:clientId/projects/:projectId/tags/:tagId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = updateTagSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const tag = await service.getTag(c.req.param("tagId"));
  if (!tag || tag.projectId !== project.id) {
    return c.json({ error: "Tag not found" }, 404);
  }

  const updated = await service.updateTag(tag.id, body);
  return c.json({ tag: updated });
});

// Delete tag
projectsRoutes.delete("/:clientId/projects/:projectId/tags/:tagId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const tag = await service.getTag(c.req.param("tagId"));
  if (!tag || tag.projectId !== project.id) {
    return c.json({ error: "Tag not found" }, 404);
  }

  await service.deleteTag(tag.id);
  return c.json({ ok: true });
});

// ============ Transaction Tagging ============

// Tag a transaction
projectsRoutes.post("/:clientId/transactions/tag", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = tagTransactionSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const tag = await service.getTag(body.tagId);
  const tagProject = tag ? await service.getProject(tag.projectId) : null;
  if (!tag || !tagProject || tagProject.firmId !== firm.id) {
    return c.json({ error: "Tag not found" }, 404);
  }

  await service.tagTransaction(body.transactionId, body.transactionType, body.tagId);

  return c.json({ ok: true });
});

// Remove tag from transaction
projectsRoutes.delete("/:clientId/transactions/tag", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = tagTransactionSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const tag = await service.getTag(body.tagId);
  const tagProject = tag ? await service.getProject(tag.projectId) : null;
  if (!tag || !tagProject || tagProject.firmId !== firm.id) {
    return c.json({ error: "Tag not found" }, 404);
  }

  await service.untagTransaction(body.transactionId, body.transactionType, body.tagId);

  return c.json({ ok: true });
});

// Get tags for a transaction
projectsRoutes.get("/:clientId/transactions/:transactionId/tags", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const parsedType = transactionTypeSchema.safeParse(c.req.query("type"));
  if (!parsedType.success) {
    return c.json({ error: "Valid transaction type required" }, 400);
  }

  const service = new ProjectsService(db);
  const tags = await service.getTransactionTags(c.req.param("transactionId"), parsedType.data);

  return c.json({ tags });
});

// ============ Auto-Tagging Rules ============

// Create auto-tag rule
projectsRoutes.post("/:clientId/auto-tag-rules", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = autoTagRuleSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const project = await service.getProject(body.projectId);
  if (!project || project.firmId !== firm.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const tag = await service.getTag(body.tagId);
  if (!tag || tag.projectId !== project.id) {
    return c.json({ error: "Tag not found for this project" }, 404);
  }

  const rule = await service.createAutoTagRule(firm.id, body);

  return c.json({ rule }, 201);
});

// List auto-tag rules
projectsRoutes.get("/:clientId/auto-tag-rules", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const service = new ProjectsService(db);
  const rules = await service.getAutoTagRulesByFirm(firm.id);

  return c.json({ rules });
});

// Update auto-tag rule
projectsRoutes.patch("/:clientId/auto-tag-rules/:ruleId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = updateAutoTagRuleSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const existing = await service.getAutoTagRule(c.req.param("ruleId"));
  if (!existing || existing.firmId !== firm.id) {
    return c.json({ error: "Rule not found" }, 404);
  }

  const rule = await service.updateAutoTagRule(existing.id, body);
  return c.json({ rule });
});

// Delete auto-tag rule
projectsRoutes.delete("/:clientId/auto-tag-rules/:ruleId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const service = new ProjectsService(db);
  const existing = await service.getAutoTagRule(c.req.param("ruleId"));
  if (!existing || existing.firmId !== firm.id) {
    return c.json({ error: "Rule not found" }, 404);
  }

  await service.deleteAutoTagRule(existing.id);
  return c.json({ ok: true });
});

// Apply auto-tag rules to a transaction
projectsRoutes.post("/:clientId/transactions/auto-tag", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z
    .object({
      transactionId: z.string().min(1),
      transactionType: transactionTypeSchema,
      merchant: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      amount: z.number().optional(),
    })
    .parse(await c.req.json());

  const service = new ProjectsService(db);
  const appliedTags = await service.applyAutoTagRules(firm.id, {
    id: body.transactionId,
    type: body.transactionType,
    merchant: body.merchant ?? null,
    category: body.category ?? null,
    description: body.description ?? null,
    amount: body.amount,
  });

  return c.json({ appliedTags });
});

// ============ Budget Snapshots ============

// Upsert budget snapshot
projectsRoutes.post("/:clientId/projects/:projectId/budget", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = budgetSnapshotSchema.parse(await c.req.json());

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const snapshot = await service.createBudgetSnapshot(
    project.id,
    body.periodStart,
    body.periodEnd,
    body.budgetRevenue,
    body.budgetExpenses,
  );
  return c.json({ snapshot }, 201);
});

// List budget snapshots
projectsRoutes.get("/:clientId/projects/:projectId/budget", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const snapshots = await service.getBudgetSnapshotsByProject(project.id);
  return c.json({ snapshots });
});

// ============ P&L Report ============

projectsRoutes.get("/:clientId/projects/:projectId/pnl", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const query = pnlQuerySchema.parse(c.req.query());

  const service = new ProjectsService(db);
  const project = await service.getProject(c.req.param("projectId"));
  if (!project || project.clientId !== client.id) {
    return c.json({ error: "Project not found" }, 404);
  }

  const pnl = await service.getProjectPnL(project.id, query.periodStart, query.periodEnd);
  if (!pnl) return c.json({ error: "Failed to generate P&L" }, 500);

  return c.json({ pnl });
});
