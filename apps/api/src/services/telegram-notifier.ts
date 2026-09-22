import type { Env } from "../env";

export interface TelegramMessageOptions {
  parseMode?: "HTML" | "Markdown";
  silent?: boolean;
}

export interface TelegramDispatchResult {
  success: boolean;
  simulated: boolean;
  messageId?: number;
  error?: string;
}

function formatAlertTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Chicago",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}/${value("day")}/${value("year")} ${value("hour")}:${value("minute")} ${value("dayPeriod")}`;
}

export class TelegramNotifierService {
  constructor(private env: Env) {}

  /**
   * Dispatches an arbitrary formatted message to the configured Telegram chat.
   * If credentials are not set, it does not pretend a notification was sent.
   * The caller receives an explicit simulated result and an actionable log.
   */
  async sendMessage(
    text: string,
    options: TelegramMessageOptions = { parseMode: "HTML" },
  ): Promise<TelegramDispatchResult> {
    const botToken = this.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = this.env.TELEGRAM_CHAT_ID?.trim();

    if (!botToken || !chatId) {
      console.warn("[Telegram] Delivery skipped: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required.");
      return { success: false, simulated: true, error: "Telegram is not configured" };
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options.parseMode ?? "HTML",
          disable_notification: options.silent ?? false,
        }),
      });

      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as {
          description?: string;
        };
        const msg = errJson.description || `HTTP ${response.status} ${response.statusText}`;
        console.warn(`[TelegramNotifier] Failed to dispatch: ${msg}`);
        return { success: false, simulated: false, error: msg };
      }

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { message_id?: number };
      };
      return {
        success: Boolean(data.ok),
        simulated: false,
        messageId: data.result?.message_id,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Unknown fetch error";
      console.warn(`[TelegramNotifier] Network exception: ${errorMsg}`);
      return { success: false, simulated: false, error: errorMsg };
    }
  }

  /** Alert when a system health check or self-healing event triggers. */
  async notifySystemHealth(status: {
    healthy: boolean;
    details: string;
    latencyMs?: number;
  }): Promise<TelegramDispatchResult> {
    const icon = status.healthy ? "🟢" : "🔴";
    const header = status.healthy ? "<b>Truepost System Healthy</b>" : "<b>Truepost System Incident</b>";
    const latency = status.latencyMs ? `\n⚡ <i>Latency: ${status.latencyMs}ms</i>` : "";
    const text = `${icon} ${header}\n\n${status.details}${latency}\n🕒 <code>${formatAlertTimestamp()}</code>`;
    return this.sendMessage(text);
  }

  /** Alert when a client submits an urgent document or missing receipt. */
  async notifyClientRequest(payload: {
    clientName: string;
    title: string;
    category?: string;
    action?: string;
  }): Promise<TelegramDispatchResult> {
    const cat = payload.category ? ` [${payload.category.toUpperCase()}]` : "";
    const action = payload.action || "Client Request Update";
    const text = `📬 <b>Truepost Client Activity</b>\n\n<b>Client:</b> ${escapeHtml(payload.clientName)}\n<b>Action:</b> ${action}${cat}\n<b>Details:</b> ${escapeHtml(payload.title)}\n🕒 <code>${formatAlertTimestamp()}</code>`;
    return this.sendMessage(text);
  }

  /** Alert when an engineer directive or custom rule is submitted by the power user. */
  async notifyRuleDirective(payload: {
    userName: string;
    title: string;
    directiveText: string;
    clientName?: string | null;
  }): Promise<TelegramDispatchResult> {
    const client = payload.clientName ? `\n<b>Target Client:</b> ${escapeHtml(payload.clientName)}` : "";
    const text = `⚙️ <b>New Rule Directive Submitted</b>\n\n<b>Author:</b> ${escapeHtml(payload.userName)}\n<b>Title:</b> ${escapeHtml(payload.title)}${client}\n<b>Directive:</b>\n<i>${escapeHtml(payload.directiveText)}</i>\n🕒 <code>${formatAlertTimestamp()}</code>`;
    return this.sendMessage(text);
  }

  /** Alert when an unhandled exception or system component fails. */
  async notifyError(component: string, error: string): Promise<TelegramDispatchResult> {
    const text = `🚨 <b>Truepost Critical Outage Alert</b>\n\n<b>Component:</b> ${escapeHtml(component)}\n<b>Error:</b>\n<code>${escapeHtml(error.slice(0, 500))}</code>\n🕒 <code>${formatAlertTimestamp()}</code>`;
    return this.sendMessage(text);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
