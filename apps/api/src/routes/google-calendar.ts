import { Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db";
import type { Env } from "../env";
import type { AuthedVars } from "../middleware/session";
import { requireSession } from "../middleware/session";
import { requireActiveBeta } from "../middleware/beta";
import { ensureFirm } from "../services/firm";
import { GoogleCalendarService } from "../services/google-calendar";
import { newId } from "../lib/id";
import { DeadlineCalendarService } from "../services/deadline-calendar";

export const googleCalendarRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
googleCalendarRoutes.use("*", requireSession);
googleCalendarRoutes.use("*", requireActiveBeta);

// ========== OAuth ==========

googleCalendarRoutes.get("/auth/url", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    redirectUri: z.string().url(),
  }).parse(c.req.query());

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, body.redirectUri);
  const { url, state } = calendarService.generateAuthUrl(firm.id, body.redirectUri);

  return c.json({ authUrl: url, state });
});

googleCalendarRoutes.get("/auth/callback", async (c) => {
  const db = createDb(c.env);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=missing_params`);
  }

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  
  try {
    const { tokens, firmId, redirectUri } = await calendarService.exchangeCodeForTokens(code, state);
    
    await calendarService.saveConfig(firmId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });

    await db.query(
      `INSERT INTO audit_events (id, firm_id, event, actor_user_id, metadata, created_at)
       VALUES ($1,$2,'google_calendar_connected',$3,$4::jsonb,NOW())`,
      [newId("aud"), firmId, c.get("userId"), JSON.stringify({ calendarId: 'primary' })],
    );

    return c.redirect(`${redirectUri}?connected=google_calendar`);
  } catch (err) {
    return c.redirect(`${c.env.APP_ORIGIN}/settings/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : 'Unknown error')}`);
  }
});

// ========== Config ==========

googleCalendarRoutes.get("/config", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const config = await calendarService.getConfig(firm.id);

  if (!config) {
    return c.json({ connected: false });
  }

  return c.json({
    connected: true,
    calendarId: config.calendarId,
    syncEnabled: config.syncEnabled,
    lastSyncAt: config.lastSyncAt,
    scope: config.scope,
  });
});

googleCalendarRoutes.post("/config/disconnect", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  await calendarService.deleteConfig(firm.id);

  await db.query(
    `INSERT INTO audit_events (id, firm_id, event, actor_user_id, created_at)
     VALUES ($1,$2,'google_calendar_disconnected',$3,NOW())`,
    [newId("aud"), firm.id, c.get("userId")],
  );

  return c.json({ ok: true });
});

googleCalendarRoutes.patch("/config", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    syncEnabled: z.boolean().optional(),
    calendarId: z.string().optional(),
  }).parse(await c.req.json());

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);

  if (body.syncEnabled !== undefined) {
    await calendarService.updateSyncState(firm.id, { syncEnabled: body.syncEnabled });
  }
  if (body.calendarId) {
    const config = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getConfig(firm.id);
    if (config) {
await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).saveConfig(firm.id, {
      accessToken: config.accessToken!,
      refreshToken: config.refreshToken!,
      expiresAt: config.tokenExpiresAt!,
      scope: config.scope!,
      calendarId: body.calendarId,
    });
    }
  }

  return c.json({ ok: true });
});

// ========== Manual Sync ==========

googleCalendarRoutes.post("/sync", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    fullSync: z.boolean().default(false),
    deadlineTypes: z.array(z.enum(['engagement', 'work_item', 'tax_extension', 'invoice'])).optional(),
    daysAhead: z.number().int().positive().max(365).default(90),
  }).parse(await c.req.json().catch(() => ({})));

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const deadlineService = new DeadlineCalendarService(db);

  const config = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getConfig(firm.id);
  if (!config) return c.json({ error: "Google Calendar not connected" }, 400);

  const configService = new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);

  // Get deadlines to sync
  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + (c.req.query("daysAhead") ? parseInt(c.req.query("daysAhead")!) : 90));
  const endDateStr = endDate.toISOString().split('T')[0];

  const deadlines = await deadlineService.getDeadlinesInRange({
    firmId: firm.id,
    startDate: new Date().toISOString().split('T')[0],
    endDate: endDateStr,
  });

  // Filter by type if specified
  const types = c.req.query("deadlineTypes")?.split(',') as any;
  const filteredDeadlines = types && types.length > 0
    ? deadlines.filter(d => types.includes(d.sourceType))
    : deadlines;

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let errors: string[] = [];

  for (const deadline of filteredDeadlines) {
    try {
      const existing = await configService.getMapping(firm.id, deadline.id, deadline.sourceType);
      const event = configService.buildEventFromDeadline({
        id: deadline.id,
        type: deadline.sourceType,
        title: deadline.title,
        description: deadline.description,
        startDate: deadline.dueDate,
        endDate: deadline.dueTime ? deadline.dueDate : null,
        allDay: !deadline.dueTime,
        clientName: deadline.clientName,
        clientEmail: deadline.clientName, // placeholder
        url: deadline.url,
        priority: deadline.priority ?? 'normal',
      });

      if (existing) {
        // Update existing event
        await configService.updateEvent(firm.id, existing.googleEventId, configService.buildEventFromDeadline({
          id: deadline.id,
          type: deadline.sourceType,
          title: deadline.title,
          description: deadline.description,
          startDate: deadline.dueDate,
          endDate: deadline.dueTime ? deadline.dueDate : null,
          allDay: !deadline.dueTime,
          clientName: deadline.clientName,
          clientEmail: deadline.clientName,
          url: deadline.url,
          priority: deadline.priority ?? 'normal',
        }));
        updated++;
      } else {
        // Create new event
        const createdEvent = await configService.createEvent(firm.id, configService.buildEventFromDeadline({
          id: deadline.id,
          type: deadline.sourceType,
          title: deadline.title,
          description: deadline.description,
          startDate: deadline.dueDate,
          endDate: deadline.dueTime ? deadline.dueDate : null,
          allDay: !deadline.dueTime,
          clientName: deadline.clientName,
          clientEmail: deadline.clientName,
          url: deadline.url,
          priority: deadline.priority ?? 'normal',
        }));
        await configService.saveMapping({
          firmId: firm.id,
          folioDeadlineId: deadline.id,
          folioDeadlineType: deadline.sourceType,
          googleEventId: createdEvent.id,
          googleCalendarId: config.calendarId,
          etag: createdEvent.etag,
          lastSyncedAt: new Date(),
          syncStatus: 'synced',
        });
        created++;
      }
    } catch (err) {
      errors.push(`Deadline ${deadline.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Update sync timestamp
  await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).updateSyncState(firm.id, {
    lastSyncAt: new Date(),
  });

  return c.json({ created, updated, deleted: 0, errors });
});

// ========== Event Management ==========

googleCalendarRoutes.post("/events", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    summary: z.string().min(1),
    description: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    allDay: z.boolean().default(false),
    location: z.string().optional(),
    reminders: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number().int().positive(),
    })).optional(),
  }).parse(await c.req.json());

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const config = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getConfig(firm.id);
  if (!config) return c.json({ error: "Google Calendar not connected" }, 400);

  const event = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).createEvent(firm.id, {
    summary: body.summary,
    description: body.description ?? null,
    start: body.allDay
      ? { date: body.startDate, dateTime: undefined, timeZone: 'America/Chicago' }
      : { dateTime: `${body.startDate}T${body.startTime || '09:00:00'}`, date: undefined, timeZone: 'America/Chicago' },
    end: body.allDay
      ? { date: body.endDate || body.startDate, dateTime: undefined, timeZone: 'America/Chicago' }
      : { dateTime: `${body.endDate || body.startDate}T${body.endTime || '10:00:00'}`, date: undefined, timeZone: 'America/Chicago' },
    location: body.location ?? null,
    reminders: body.reminders ? {
      useDefault: false,
      overrides: body.reminders,
    } : null,
    extendedProperties: {
      private: {},
    },
  });

  return c.json({ event }, 201);
});

googleCalendarRoutes.get("/events", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const query = z.object({
    timeMin: z.string().optional(),
    timeMax: z.string().optional(),
    maxResults: z.coerce.number().int().positive().max(250).default(100),
    syncToken: z.string().optional(),
  }).parse(c.req.query());

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const config = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getConfig(firm.id);
  if (!config) return c.json({ error: "Google Calendar not connected" }, 400);

  const result = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).listEvents(firm.id, {
    timeMin: query.timeMin,
    timeMax: query.timeMax,
    syncToken: query.syncToken,
    maxResults: query.maxResults,
  });

  return c.json({ events: result.events, nextSyncToken: result.nextSyncToken, nextPageToken: result.nextPageToken });
});

googleCalendarRoutes.get("/events/:eventId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const config = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getConfig(firm.id);
  if (!config) return c.json({ error: "Google Calendar not connected" }, 400);

  const event = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getEvent(firm.id, c.req.param("eventId"));
  if (!event) return c.json({ error: "Event not found" }, 404);

  return c.json({ event });
});

googleCalendarRoutes.patch("/events/:eventId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const body = z.object({
    summary: z.string().optional(),
    description: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    allDay: z.boolean().optional(),
    location: z.string().optional(),
    reminders: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number().int().positive(),
    })).optional(),
  }).parse(await c.req.json());

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const config = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getConfig(firm.id);
  if (!config) return c.json({ error: "Google Calendar not connected" }, 400);

  // Build partial event update
  const updates: any = {};
  if (body.summary) updates.summary = body.summary;
  if (body.description !== undefined) updates.description = body.description;
  if (body.location !== undefined) updates.location = body.location;
  if (body.startDate) {
    updates.start = body.allDay
      ? { date: body.startDate, timeZone: 'America/Chicago' }
      : { dateTime: `${body.startDate}T${body.startTime || '09:00:00'}`, timeZone: 'America/Chicago' };
  }
  if (body.endDate) {
    updates.end = body.allDay
      ? { date: body.endDate, timeZone: 'America/Chicago' }
      : { dateTime: `${body.endDate}T${body.endTime || '10:00:00'}`, timeZone: 'America/Chicago' };
  }

  const event = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).patchEvent(firm.id, c.req.param("eventId"), updates);
  return c.json({ event });
});

googleCalendarRoutes.delete("/events/:eventId", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const config = await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).getConfig(firm.id);
  if (!config) return c.json({ error: "Google Calendar not connected" }, 400);

  await new (await import("../services/google-calendar")).GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!).deleteEvent(firm.id, c.req.param("eventId"));
  return c.json({ ok: true });
});

// ========== Deadline Sync Status ==========

googleCalendarRoutes.get("/deadlines/sync-status", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));

  const calendarService = new GoogleCalendarService(db, c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, c.env.APP_ORIGIN!);
  const mappings = await calendarService.getMappingsByFirm(firm.id);

  const status = {
    total: mappings.length,
    synced: mappings.filter(m => m.syncStatus === 'synced').length,
    pending: mappings.filter(m => m.syncStatus === 'pending').length,
    conflict: mappings.filter(m => m.syncStatus === 'conflict').length,
    deleted: mappings.filter(m => m.syncStatus === 'deleted').length,
    byType: {} as Record<string, number>,
  };

  for (const m of mappings) {
    status.byType[m.folioDeadlineType] = (status.byType[m.folioDeadlineType] || 0) + 1;
  }

  return c.json({ status });
});