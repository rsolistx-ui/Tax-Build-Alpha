import type { Db } from "../db";
import { newId } from "../lib/id";

export interface GoogleCalendarConfig {
  id: string;
  firmId: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scope: string | null;
  calendarId: string;
  syncEnabled: boolean;
  lastSyncAt: Date | null;
  lastSyncToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarEventMapping {
  id: string;
  firmId: string;
  folioDeadlineId: string;
  folioDeadlineType: 'engagement' | 'work_item' | 'tax_extension' | 'invoice';
  googleEventId: string;
  googleCalendarId: string;
  etag: string | null;
  lastSyncedAt: Date;
  syncStatus: 'synced' | 'pending' | 'conflict' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
}

export interface GoogleOAuthState {
  id: string;
  firmId: string;
  state: string;
  redirectUri: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  start: {
    dateTime?: string | null;
    date?: string | null;
    timeZone: string;
  };
  end: {
    dateTime?: string | null;
    date?: string | null;
    timeZone: string;
  };
  location: string | null;
  reminders: {
    useDefault: boolean;
    overrides: Array<{ method: 'email' | 'popup'; minutes: number }>;
  } | null;
  extendedProperties: {
    private: Record<string, string>;
  } | null;
  etag: string;
  htmlLink: string;
  created: string;
  updated: string;
}

export interface DeadlineForCalendar {
  id: string;
  type: 'engagement' | 'work_item' | 'tax_extension' | 'invoice';
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  allDay: boolean;
  clientName: string;
  clientEmail: string | null;
  url: string;
  priority: 'high' | 'normal' | 'low';
}

export class GoogleCalendarService {
  private db: Db;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(db: Db, clientId: string, clientSecret: string, redirectUri: string) {
    this.db = db;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  // ========== OAuth ==========

  generateAuthUrl(firmId: string, redirectUri: string): { url: string; state: string } {
    const state = newId("gcs");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    this.db.query(
      `INSERT INTO google_oauth_states (id, firm_id, state, redirect_uri, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [newId("gcs"), firmId, state, redirectUri, expiresAt.toISOString()],
    );

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
    };
  }

  async exchangeCodeForTokens(code: string, state: string): Promise<{ tokens: GoogleTokens; firmId: string; redirectUri: string }> {
    const [stateRow] = await this.db.query<{ firm_id: string; redirect_uri: string }>(
      `SELECT firm_id, redirect_uri FROM google_oauth_states WHERE state = $1 AND expires_at > NOW()`,
      [state],
    );
    if (!stateRow) throw new Error("Invalid or expired OAuth state");

    const firmId = stateRow.firm_id;
    const redirectUri = stateRow.redirect_uri;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${error}`);
    }

    const data = await tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
      token_type: string;
    };

    await this.db.query(`DELETE FROM google_oauth_states WHERE state = $1`, [state]);

    return {
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        scope: data.scope,
      },
      firmId,
      redirectUri,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  // ========== Config Management ==========

  async saveConfig(firmId: string, config: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string;
    calendarId?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO google_calendar_config (id, firm_id, access_token, refresh_token, token_expires_at, scope, calendar_id, sync_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       ON CONFLICT (firm_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         scope = EXCLUDED.scope,
         calendar_id = COALESCE(EXCLUDED.calendar_id, google_calendar_config.calendar_id),
         updated_at = NOW()`,
      [newId("gcc"), firmId, config.accessToken, config.refreshToken, config.expiresAt.toISOString(), config.scope, config.calendarId ?? 'primary'],
    );
  }

  async getConfig(firmId: string): Promise<GoogleCalendarConfig | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM google_calendar_config WHERE firm_id = $1`,
      [firmId],
    );
    return row ? this.mapConfig(row) : null;
  }

  async updateSyncState(firmId: string, updates: {
    lastSyncAt?: Date;
    lastSyncToken?: string | null;
    syncEnabled?: boolean;
  }): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [firmId];
    let idx = 2;

    if (updates.lastSyncAt !== undefined) {
      sets.push(`last_sync_at = $${idx++}`);
      params.push(updates.lastSyncAt.toISOString());
    }
    if (updates.lastSyncToken !== undefined) {
      sets.push(`last_sync_token = $${idx++}`);
      params.push(updates.lastSyncToken);
    }
    if (updates.syncEnabled !== undefined) {
      sets.push(`sync_enabled = $${idx++}`);
      params.push(updates.syncEnabled);
    }

    if (sets.length === 0) return;
    sets.push(`updated_at = NOW()`);

    await this.db.query(
      `UPDATE google_calendar_config SET ${sets.join(', ')} WHERE firm_id = $1`,
      params,
    );
  }

  async deleteConfig(firmId: string): Promise<void> {
    await this.db.query(`DELETE FROM google_calendar_config WHERE firm_id = $1`, [firmId]);
    await this.db.query(`DELETE FROM calendar_event_mappings WHERE firm_id = $1`, [firmId]);
  }

  // ========== API Client ==========

  private async getValidAccessToken(firmId: string): Promise<string> {
    const config = await this.getConfig(firmId);
    if (!config || !config.accessToken) throw new Error("Google Calendar not connected");

    if (config.tokenExpiresAt && new Date() >= config.tokenExpiresAt) {
      if (!config.refreshToken) throw new Error("Token expired and no refresh token available");

      const { accessToken, expiresAt } = await this.refreshAccessToken(config.refreshToken);
      await this.db.query(
        `UPDATE google_calendar_config SET access_token = $1, token_expires_at = $2, updated_at = NOW() WHERE firm_id = $3`,
        [accessToken, expiresAt.toISOString(), firmId],
      );
      return accessToken;
    }

    return config.accessToken;
  }

  private async request<T>(firmId: string, method: string, path: string, body?: any): Promise<T> {
    const accessToken = await this.getValidAccessToken(firmId);
    const url = `https://www.googleapis.com/calendar/v3${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401) {
      // Token might have been revoked
      const config = await this.getConfig(firmId);
      if (config?.refreshToken) {
        const { accessToken, expiresAt } = await this.refreshAccessToken(config.refreshToken);
        await this.db.query(
          `UPDATE google_calendar_config SET access_token = $1, token_expires_at = $2, updated_at = NOW() WHERE firm_id = $3`,
          [accessToken, expiresAt.toISOString(), firmId],
        );
        // Retry once
        return this.request(firmId, method, path, body);
      }
      throw new Error("Google Calendar access revoked");
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} ${error}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json();
  }

  // ========== Calendar Events ==========

  async createEvent(firmId: string, event: Omit<GoogleCalendarEvent, 'id' | 'etag' | 'htmlLink' | 'created' | 'updated'>): Promise<GoogleCalendarEvent> {
    const calendarId = (await this.getConfig(firmId))?.calendarId ?? 'primary';
    return this.request(firmId, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events`, event);
  }

  async getEvent(firmId: string, eventId: string): Promise<GoogleCalendarEvent | null> {
    const calendarId = (await this.getConfig(firmId))?.calendarId ?? 'primary';
    try {
      return await this.request(firmId, 'GET', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (e) {
      if ((e as Error).message.includes('404')) return null;
      throw e;
    }
  }

  async updateEvent(firmId: string, eventId: string, event: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent> {
    const calendarId = (await this.getConfig(firmId))?.calendarId ?? 'primary';
    return this.request(firmId, 'PUT', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, event);
  }

  async patchEvent(firmId: string, eventId: string, event: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent> {
    const calendarId = (await this.getConfig(firmId))?.calendarId ?? 'primary';
    return this.request(firmId, 'PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, event);
  }

  async deleteEvent(firmId: string, eventId: string): Promise<void> {
    const calendarId = (await this.getConfig(firmId))?.calendarId ?? 'primary';
    await this.request(firmId, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }

  async listEvents(firmId: string, options?: {
    timeMin?: string;
    timeMax?: string;
    syncToken?: string;
    maxResults?: number;
  }): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }> {
    const calendarId = (await this.getConfig(firmId))?.calendarId ?? 'primary';
    const params = new URLSearchParams();
    if (options?.timeMin) params.set('timeMin', options.timeMin);
    if (options?.timeMax) params.set('timeMax', options.timeMax);
    if (options?.syncToken) params.set('syncToken', options.syncToken);
    if (options?.maxResults) params.set('maxResults', String(options.maxResults));
    params.set('singleEvents', 'true');
    params.set('orderBy', 'startTime');

    const result = await this.request<any>(firmId, 'GET', `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
    return {
      events: result.items ?? [],
      nextSyncToken: result.nextSyncToken,
      nextPageToken: result.nextPageToken,
    };
  }

  // ========== Event Mappings ==========

  async saveMapping(mapping: Omit<CalendarEventMapping, 'id' | 'createdAt' | 'updatedAt'>): Promise<CalendarEventMapping> {
    await this.db.query(
      `INSERT INTO calendar_event_mappings (id, firm_id, folio_deadline_id, folio_deadline_type, google_event_id, google_calendar_id, etag, last_synced_at, sync_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),'synced')
       ON CONFLICT (firm_id, folio_deadline_id, folio_deadline_type) DO UPDATE SET
         google_event_id = EXCLUDED.google_event_id,
         google_calendar_id = EXCLUDED.google_calendar_id,
         etag = EXCLUDED.etag,
         last_synced_at = NOW(),
         sync_status = 'synced',
         updated_at = NOW()`,
      [newId("cem"), mapping.firmId, mapping.folioDeadlineId, mapping.folioDeadlineType, mapping.googleEventId, mapping.googleCalendarId, mapping.etag ?? null],
    );
    const [row] = await this.db.query<any>(
      `SELECT * FROM calendar_event_mappings WHERE firm_id = $1 AND folio_deadline_id = $2 AND folio_deadline_type = $3`,
      [mapping.firmId, mapping.folioDeadlineId, mapping.folioDeadlineType],
    );
    return this.mapMapping(row);
  }

  async getMapping(firmId: string, deadlineId: string, deadlineType: string): Promise<CalendarEventMapping | null> {
    const [row] = await this.db.query<any>(
      `SELECT * FROM calendar_event_mappings WHERE firm_id = $1 AND folio_deadline_id = $2 AND folio_deadline_type = $3`,
      [firmId, deadlineId, deadlineType],
    );
    return row ? this.mapMapping(row) : null;
  }

  async getMappingsByFirm(firmId: string): Promise<CalendarEventMapping[]> {
    const rows = await this.db.query<any>(
      `SELECT * FROM calendar_event_mappings WHERE firm_id = $1 ORDER BY last_synced_at DESC`,
      [firmId],
    );
    return rows.map(this.mapMapping);
  }

  async deleteMapping(firmId: string, deadlineId: string, deadlineType: string): Promise<void> {
    await this.db.query(
      `DELETE FROM calendar_event_mappings WHERE firm_id = $1 AND folio_deadline_id = $2 AND folio_deadline_type = $3`,
      [firmId, deadlineId, deadlineType],
    );
  }

  async markMappingDeleted(firmId: string, deadlineId: string, deadlineType: string): Promise<void> {
    await this.db.query(
      `UPDATE calendar_event_mappings SET sync_status = 'deleted', updated_at = NOW()
       WHERE firm_id = $1 AND folio_deadline_id = $2 AND folio_deadline_type = $3`,
      [firmId, deadlineId, deadlineType],
    );
  }

  // ========== Deadline → Google Event Conversion ==========

  buildEventFromDeadline(deadline: DeadlineForCalendar): Omit<GoogleCalendarEvent, 'id' | 'etag' | 'htmlLink' | 'created' | 'updated'> {
    const isAllDay = deadline.allDay || !deadline.endDate;
    const start = isAllDay
      ? { date: deadline.startDate, dateTime: undefined, timeZone: 'America/Chicago' }
      : { dateTime: `${deadline.startDate}T09:00:00`, date: undefined, timeZone: 'America/Chicago' };

    const end = isAllDay
      ? { date: deadline.endDate || deadline.startDate, dateTime: undefined, timeZone: 'America/Chicago' }
      : { dateTime: `${deadline.endDate || deadline.startDate}T10:00:00`, date: undefined, timeZone: 'America/Chicago' };

    const reminderMinutes = deadline.priority === 'high' ? [60, 1440, 10080] : [1440, 10080]; // 1hr, 1day, 1week vs 1day, 1week

    return {
      summary: `${deadline.title} — ${deadline.clientName}`,
      description: [
        deadline.description,
        '',
        `Client: ${deadline.clientName}${deadline.clientEmail ? ` (${deadline.clientEmail})` : ''}`,
        `Type: ${deadline.type.replace('_', ' ')}`,
        `Priority: ${deadline.priority}`,
        `Folio: ${deadline.url}`,
      ].filter(Boolean).join('\n'),
      start,
      end,
      location: null,
      reminders: {
        useDefault: false,
        overrides: reminderMinutes.map(minutes => ({ method: 'popup' as const, minutes })),
      },
      extendedProperties: {
        private: {
          folio_deadline_id: deadline.id,
          folio_deadline_type: deadline.type,
        },
      },
    };
  }

  // ========== Mappers ==========

  private mapConfig(row: any): GoogleCalendarConfig {
    return {
      id: row.id,
      firmId: row.firm_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
      scope: row.scope,
      calendarId: row.calendar_id,
      syncEnabled: row.sync_enabled,
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
      lastSyncToken: row.last_sync_token,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapMapping(row: any): CalendarEventMapping {
    return {
      id: row.id,
      firmId: row.firm_id,
      folioDeadlineId: row.folio_deadline_id,
      folioDeadlineType: row.folio_deadline_type,
      googleEventId: row.google_event_id,
      googleCalendarId: row.google_calendar_id,
      etag: row.etag,
      lastSyncedAt: new Date(row.last_synced_at),
      syncStatus: row.sync_status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}