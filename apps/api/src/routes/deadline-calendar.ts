import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { getClient } from "../services/clients";
import { DeadlineCalendarService, generateICal, type CalendarViewOptions, type UpcomingDeadlinesOptions } from "../services/deadline-calendar";

export const deadlineCalendarRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
deadlineCalendarRoutes.use("*", requireSession);
deadlineCalendarRoutes.use("*", requireActiveBeta);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sourceTypeSchema = z.enum(['engagement', 'work_item', 'tax_extension', 'invoice']);

// Get deadlines in a date range (for month/week/list views)
deadlineCalendarRoutes.get("/range", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    startDate: dateSchema,
    endDate: dateSchema,
    clientId: z.string().optional(),
    sourceTypes: z.string().optional(), // comma-separated
    statuses: z.string().optional(),
  }).parse(c.req.query());

  const service = new DeadlineCalendarService(db);
  const options: CalendarViewOptions = {
    firmId: firm.id,
    clientId: query.clientId,
    startDate: query.startDate,
    endDate: query.endDate,
    sourceTypes: query.sourceTypes?.split(',') as any,
    statuses: query.statuses?.split(',') ?? [],
  };

  const deadlines = await service.getDeadlinesInRange(options);
  return c.json({ deadlines });
});

// Get upcoming deadlines (next N days)
deadlineCalendarRoutes.get("/upcoming", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    clientId: z.string().optional(),
    days: z.coerce.number().int().positive().max(365).default(30),
    limit: z.coerce.number().int().positive().max(200).default(50),
    sourceTypes: z.string().optional(),
  }).parse(c.req.query());

  const service = new DeadlineCalendarService(db);
  const options: UpcomingDeadlinesOptions = {
    firmId: firm.id,
    clientId: query.clientId,
    days: query.days,
    limit: query.limit,
    sourceTypes: query.sourceTypes?.split(',') as any,
  };

  const deadlines = await service.getUpcomingDeadlines(options);
  return c.json({ deadlines });
});

// Get deadlines for a specific date
deadlineCalendarRoutes.get("/date/:date", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const date = dateSchema.parse(c.req.param("date"));

  const service = new DeadlineCalendarService(db);
  const deadlines = await service.getDeadlinesByDate(firm.id, date);
  return c.json({ deadlines, date });
});

// Monthly view
deadlineCalendarRoutes.get("/month/:year/:month", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const year = z.coerce.number().int().min(2020).max(2035).parse(c.req.param("year"));
  const month = z.coerce.number().int().min(1).max(12).parse(c.req.param("month"));
  const clientId = c.req.query("clientId") || undefined;

  const service = new DeadlineCalendarService(db);
  const deadlines = await service.getMonthlyView(firm.id, year, month, clientId);

  // Group by date for easier calendar rendering
  const byDate: Record<string, typeof deadlines> = {};
  for (const d of deadlines) {
    (byDate[d.dueDate] ??= []).push(d);
  }

  return c.json({ year, month, deadlines, byDate });
});

// Weekly view (week starting on given date)
deadlineCalendarRoutes.get("/week/:weekStart", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const weekStart = dateSchema.parse(c.req.param("weekStart"));
  const clientId = c.req.query("clientId") || undefined;

  const service = new DeadlineCalendarService(db);
  const deadlines = await service.getWeeklyView(firm.id, weekStart, clientId);

  // Group by date
  const byDate: Record<string, typeof deadlines> = {};
  for (const d of deadlines) {
    (byDate[d.dueDate] ??= []).push(d);
  }

  return c.json({ weekStart, deadlines, byDate });
});

// iCal export
deadlineCalendarRoutes.get("/export/ical", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    clientId: z.string().optional(),
    days: z.coerce.number().int().positive().max(365).default(90),
    sourceTypes: z.string().optional(),
  }).parse(c.req.query());

  const service = new DeadlineCalendarService(db);
  const deadlines = await service.getUpcomingDeadlines({
    firmId: firm.id,
    clientId: query.clientId,
    days: query.days,
    limit: 200,
    sourceTypes: query.sourceTypes?.split(',') as any,
  });

  const ical = await generateICal(deadlines, { firmName: firm.name });

  return c.body(ical, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="deadlines-${firm.name.replace(/\s+/g, '-')}.ics"`,
  });
});

// Get deadline summary counts by type for a date range
deadlineCalendarRoutes.get("/summary", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    startDate: dateSchema,
    endDate: dateSchema,
    clientId: z.string().optional(),
  }).parse(c.req.query());

  const service = new DeadlineCalendarService(db);
  const deadlines = await service.getDeadlinesInRange({
    firmId: firm.id,
    clientId: query.clientId,
    startDate: query.startDate,
    endDate: query.endDate,
  });

  const summary = {
    total: deadlines.length,
    byType: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
    byPriority: {} as Record<string, number>,
    overdue: 0,
    dueToday: 0,
    dueThisWeek: 0,
  };

  const today = new Date().toISOString().split('T')[0];
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  for (const d of deadlines) {
    summary.byType[d.sourceType] = (summary.byType[d.sourceType] ?? 0) + 1;
    summary.byStatus[d.status] = (summary.byStatus[d.status] ?? 0) + 1;
    if (d.priority) summary.byPriority[d.priority] = (summary.byPriority[d.priority] ?? 0) + 1;

    if (d.dueDate < today && !['completed', 'paid', 'complete', 'filed', 'approved'].includes(d.status)) {
      summary.overdue++;
    }
    if (d.dueDate === today) summary.dueToday++;
    if (d.dueDate >= today && d.dueDate <= weekEndStr) summary.dueThisWeek++;
  }

  return c.json({ summary });
});