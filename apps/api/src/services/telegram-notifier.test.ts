import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramNotifierService } from "./telegram-notifier";
import type { Env } from "../env";

describe("TelegramNotifierService", () => {
  const mockEnv: Env = {
    AUTH_DB: {} as any,
    DATABASE_URL: "postgresql://mock",
    RECEIPTS: {} as any,
    BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long",
    BETTER_AUTH_URL: "http://localhost:8787",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
    TELEGRAM_BOT_TOKEN: "mock_token_123",
    TELEGRAM_CHAT_ID: "123456789",
  };

  const unconfiguredEnv: Env = {
    ...mockEnv,
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_CHAT_ID: undefined,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports that delivery was skipped when Telegram credentials are not set", async () => {
    const service = new TelegramNotifierService(unconfiguredEnv);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.sendMessage("Test message");

    expect(result.success).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.error).toBe("Telegram is not configured");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Delivery skipped"));
  });

  it("sends formatted message via Telegram Bot API when configured", async () => {
    const service = new TelegramNotifierService(mockEnv);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 9942 } }),
    } as any);

    const result = await service.sendMessage("<b>Hello world</b>");

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(false);
    expect(result.messageId).toBe(9942);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.telegram.org/botmock_token_123/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "123456789",
          text: "<b>Hello world</b>",
          parse_mode: "HTML",
          disable_notification: false,
        }),
      }),
    );
  });

  it("formats and dispatches system health check alerts", async () => {
    const service = new TelegramNotifierService(mockEnv);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1001 } }),
    } as any);

    const result = await service.notifySystemHealth({
      healthy: true,
      details: "All 4 clusters operational",
      latencyMs: 38,
    });

    expect(result.success).toBe(true);
    const sentBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(sentBody.text).toContain("Truepost System Healthy");
    expect(sentBody.text).toContain("All 4 clusters operational");
    expect(sentBody.text).toContain("38ms");
  });

  it("formats and dispatches rule directives submitted by power user", async () => {
    const service = new TelegramNotifierService(mockEnv);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1002 } }),
    } as any);

    const result = await service.notifyRuleDirective({
      userName: "Phyllis CPA",
      title: "Mileage Threshold Policy",
      directiveText: "Cap all personal vehicle reimbursements at 5,000 miles",
      clientName: "Acme Logistics",
    });

    expect(result.success).toBe(true);
    const sentBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(sentBody.text).toContain("New Rule Directive Submitted");
    expect(sentBody.text).toContain("Phyllis CPA");
    expect(sentBody.text).toContain("Mileage Threshold Policy");
    expect(sentBody.text).toContain("Acme Logistics");
  });

  it("handles Telegram network errors gracefully without crashing", async () => {
    const service = new TelegramNotifierService(mockEnv);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout"));

    const result = await service.notifyError("Database", "Connection pool exhausted");

    expect(result.success).toBe(false);
    expect(result.simulated).toBe(false);
    expect(result.error).toBe("Network timeout");
  });
});
