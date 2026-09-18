import type { Db } from "../db";

export type DeadlineSourceType = 'engagement' | 'work_item' | 'tax_extension' | 'invoice';

export interface DeadlineItem {
  id: string;
  sourceType: DeadlineSourceType;
  sourceId: string;
  clientId: string;
  clientName: string;
  title: string;
  description: string | null;
  dueDate: string;
  dueTime: string | null;
  status: string;
  priority: 'high' | 'normal' | 'low' | null;
  url: string;
  metadata: Record<string, any>;
}

export interface CalendarViewOptions {
  firmId: string;
  clientId?: string;
  startDate: string;
  endDate: string;
  sourceTypes?: DeadlineSourceType[];
  statuses?: string[];
}

export interface UpcomingDeadlinesOptions {
  firmId: string;
  clientId?: string;
  days?: number;
  limit?: number;
  sourceTypes?: DeadlineSourceType[];
}

export class DeadlineCalendarService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getDeadlinesInRange(options: CalendarViewOptions): Promise<DeadlineItem[]> {
    const { firmId, clientId, startDate, endDate, sourceTypes, statuses } = options;
    const types = sourceTypes ?? ['engagement', 'work_item', 'tax_extension', 'invoice'];
    const stats = statuses ?? [];

    const items: DeadlineItem[] = [];

    if (types.includes('engagement')) {
      let sql = `
        SELECT e.id, e.client_id, c.name as client_name, e.title, e.service_type, e.status, e.due_date,
               e.tax_year, e.recurrence
        FROM engagements e
        JOIN clients c ON c.id = e.client_id
        WHERE e.firm_id = $1 AND e.due_date IS NOT NULL
          AND e.due_date >= $2 AND e.due_date <= $3
      `;
      const params: any[] = [firmId, startDate, endDate];
      let idx = 4;
      if (clientId) { sql += ` AND e.client_id = $${idx++}`; params.push(clientId); }
      if (stats.length > 0) { sql += ` AND e.status = ANY($${idx++})`; params.push(stats); }
      sql += ` ORDER BY e.due_date, e.created_at`;

      const rows = await this.db.query<any>(sql, params);
      for (const row of rows) {
        items.push({
          id: row.id,
          sourceType: 'engagement',
          sourceId: row.id,
          clientId: row.client_id,
          clientName: row.client_name,
          title: row.title,
          description: `${row.service_type}${row.tax_year ? ` — Tax Year ${row.tax_year}` : ''}${row.recurrence ? ` (${row.recurrence})` : ''}`,
          dueDate: row.due_date,
          dueTime: null,
          status: row.status,
          priority: this.priorityFromEngagementStatus(row.status),
          url: `/engagements/${row.id}`,
          metadata: { serviceType: row.service_type, taxYear: row.tax_year, recurrence: row.recurrence },
        });
      }
    }

    if (types.includes('work_item')) {
      let sql = `
        SELECT wi.id, wi.client_id, c.name as client_name, wi.title, wi.description, wi.status, wi.priority, wi.due_at,
               wi.work_type, wi.source_type, wi.source_id, e.title as engagement_title
        FROM work_items wi
        JOIN clients c ON c.id = wi.client_id
        LEFT JOIN engagements e ON e.id = wi.engagement_id
        WHERE wi.firm_id = $1 AND wi.due_at IS NOT NULL
          AND wi.due_at::date >= $2 AND wi.due_at::date <= $3
      `;
      const params: any[] = [firmId, startDate, endDate];
      let idx = 4;
      if (clientId) { sql += ` AND wi.client_id = $${idx++}`; params.push(clientId); }
      if (stats.length > 0) { sql += ` AND wi.status = ANY($${idx++})`; params.push(stats); }
      sql += ` ORDER BY wi.due_at, wi.created_at`;

      const rows = await this.db.query<any>(sql, params);
      for (const row of rows) {
        items.push({
          id: row.id,
          sourceType: 'work_item',
          sourceId: row.id,
          clientId: row.client_id,
          clientName: row.client_name,
          title: row.title,
          description: row.description ?? (row.engagement_title ? `Engagement: ${row.engagement_title}` : null),
          dueDate: row.due_at.split('T')[0],
          dueTime: row.due_at.split('T')[1]?.substring(0, 5) ?? null,
          status: row.status,
          priority: row.priority as 'high' | 'normal' | 'low' | null,
          url: `/work-items/${row.id}`,
          metadata: { workType: row.work_type, sourceType: row.source_type, sourceId: row.source_id },
        });
      }
    }

    if (types.includes('tax_extension')) {
      let sql = `
        SELECT te.id, te.client_id, c.name as client_name, te.tax_year, te.form_type, te.status, te.due_date
        FROM tax_extensions te
        JOIN clients c ON c.id = te.client_id
        WHERE te.firm_id = $1 AND te.due_date >= $2 AND te.due_date <= $3
      `;
      const params: any[] = [firmId, startDate, endDate];
      let idx = 4;
      if (clientId) { sql += ` AND te.client_id = $${idx++}`; params.push(clientId); }
      if (stats.length > 0) { sql += ` AND te.status = ANY($${idx++})`; params.push(stats); }
      sql += ` ORDER BY te.due_date, te.created_at`;

      const rows = await this.db.query<any>(sql, params);
      for (const row of rows) {
        items.push({
          id: row.id,
          sourceType: 'tax_extension',
          sourceId: row.id,
          clientId: row.client_id,
          clientName: row.client_name,
          title: `Tax Extension — ${row.form_type} (${row.tax_year})`,
          description: `Form ${row.form_type} for tax year ${row.tax_year}`,
          dueDate: row.due_date,
          dueTime: null,
          status: row.status,
          priority: row.status === 'pending' ? 'high' : 'normal',
          url: `/tax-extensions/${row.id}`,
          metadata: { taxYear: row.tax_year, formType: row.form_type },
        });
      }
    }

    if (types.includes('invoice')) {
      let sql = `
        SELECT i.id, i.client_id, c.name as client_name, i.number, i.status, i.due_date, i.total, i.balance_due
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        WHERE i.firm_id = $1 AND i.due_date >= $2 AND i.due_date <= $3
      `;
      const params: any[] = [firmId, startDate, endDate];
      let idx = 4;
      if (clientId) { sql += ` AND i.client_id = $${idx++}`; params.push(clientId); }
      if (stats.length > 0) { sql += ` AND i.status = ANY($${idx++})`; params.push(stats); }
      sql += ` ORDER BY i.due_date, i.created_at`;

      const rows = await this.db.query<any>(sql, params);
      for (const row of rows) {
        items.push({
          id: row.id,
          sourceType: 'invoice',
          sourceId: row.id,
          clientId: row.client_id,
          clientName: row.client_name,
          title: `Invoice ${row.number}`,
          description: `Amount: $${Number(row.total).toFixed(2)}${Number(row.balance_due) > 0 ? ` — Balance Due: $${Number(row.balance_due).toFixed(2)}` : ''}`,
          dueDate: row.due_date,
          dueTime: null,
          status: row.status,
          priority: row.status === 'overdue' ? 'high' : row.status === 'sent' ? 'normal' : 'low',
          url: `/billing/${row.id}`,
          metadata: { total: Number(row.total), balanceDue: Number(row.balance_due), invoiceNumber: row.number },
        });
      }
    }

    return items.sort((a, b) => {
      const dateA = a.dueDate + (a.dueTime ? `T${a.dueTime}` : '');
      const dateB = b.dueDate + (b.dueTime ? `T${b.dueTime}` : '');
      return dateA.localeCompare(dateB);
    });
  }

  async getUpcomingDeadlines(options: UpcomingDeadlinesOptions): Promise<DeadlineItem[]> {
    const { firmId, clientId, days = 30, limit = 50, sourceTypes } = options;
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    const endDateStr = endDate.toISOString().split('T')[0];

    const items = await this.getDeadlinesInRange({
      firmId,
      clientId,
      startDate: today,
      endDate: endDateStr,
      sourceTypes,
    });

    return items.slice(0, limit);
  }

  async getDeadlinesByDate(firmId: string, date: string): Promise<DeadlineItem[]> {
    return this.getDeadlinesInRange({ firmId, startDate: date, endDate: date });
  }

  async getMonthlyView(firmId: string, year: number, month: number, clientId?: string): Promise<DeadlineItem[]> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];
    return this.getDeadlinesInRange({ firmId, clientId, startDate, endDate });
  }

  async getWeeklyView(firmId: string, weekStart: string, clientId?: string): Promise<DeadlineItem[]> {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endDateStr = end.toISOString().split('T')[0];
    return this.getDeadlinesInRange({ firmId, clientId, startDate: weekStart, endDate: endDateStr });
  }

  private priorityFromEngagementStatus(status: string): 'high' | 'normal' | 'low' {
    if (['waiting_on_client', 'professional_review'].includes(status)) return 'high';
    if (['active', 'planned'].includes(status)) return 'normal';
    return 'low';
  }
}

export async function generateICal(events: DeadlineItem[], options: { firmName: string; timezone?: string } = { firmName: 'Folio' }): Promise<string> {
  const timezone = options.timezone ?? 'America/Chicago';
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Folio Tax//Deadline Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${options.firmName} Deadlines`,
    `X-WR-TIMEZONE:${timezone}`,
  ].join('\r\n');

  for (const event of events) {
    const uid = `${event.sourceType}-${event.id}@folio-tax`;
    const dtStamp = now;
    const dtStart = event.dueTime
      ? `${event.dueDate.replace(/-/g, '')}T${event.dueTime.replace(':', '')}00`
      : `${event.dueDate.replace(/-/g, '')}`;
    const isAllDay = !event.dueTime;

    const summary = `${event.title} — ${event.clientName}`;
    const description = [
      `Type: ${event.sourceType.replace('_', ' ')}`,
      `Client: ${event.clientName}`,
      event.description ? `Details: ${event.description}` : '',
      `Status: ${event.status}`,
      event.url ? `URL: ${event.url}` : '',
    ].filter(Boolean).join('\\n');

    ical += '\r\n' + [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      isAllDay ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`,
      isAllDay ? `DTEND;VALUE=DATE:${dtStart}` : `DTEND:${dtStart}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      `STATUS:${event.status === 'completed' || event.status === 'paid' || event.status === 'complete' ? 'COMPLETED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ].join('\r\n');
  }

  ical += '\r\nEND:VCALENDAR';
  return ical;
}