import { describe, it, expect, vi } from "vitest";
import { SmsReceiptIntakeService, normalizePhoneNumber } from "./sms-receipt-intake";
import type { Db } from "../db";
import type { Env } from "../env";

describe("SmsReceiptIntakeService", () => {
  it("normalizes diverse US phone number formats", () => {
    expect(normalizePhoneNumber("+1 (555) 234-5678")).toBe("15552345678");
    expect(normalizePhoneNumber("555-234-5678")).toBe("15552345678");
    expect(normalizePhoneNumber("15552345678")).toBe("15552345678");
    expect(normalizePhoneNumber("(555) 234-5678")).toBe("15552345678");
    expect(normalizePhoneNumber("")).toBe("");
  });

  it("matches client by phone number", async () => {
    const mockClients = [
      { id: "cli_1", firm_id: "firm_1", name: "Apex Logistics", phone: "(555) 234-5678" },
      { id: "cli_2", firm_id: "firm_1", name: "Beacon Dental", phone: "555-987-6543" },
    ];

    const db: Db = {
      query: vi.fn(async () => mockClients) as any,
      transaction: vi.fn(async (s) => s.map(() => [])) as any,
    };
    const env = { RECEIPTS: { put: vi.fn() } } as unknown as Env;

    const service = new SmsReceiptIntakeService(db, env);
    const client = await service.findClientByPhone("+1 (555) 987-6543");

    expect(client).toBeTruthy();
    expect(client?.id).toBe("cli_2");
    expect(client?.name).toBe("Beacon Dental");
  });

  it("places an SMS receipt in the review queue without silently changing the books", async () => {
    const db: Db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM client_requests")) return [];
        if (sql.includes("FROM bank_transactions")) {
          return [{ id: "bt_123", description: "Home Depot #4401", amount: -145.2 }];
        }
        return [];
      }) as any,
      transaction: vi.fn(async (s) => s.map(() => [])) as any,
    };
    const mockR2Put = vi.fn(async () => {});
    const env = { RECEIPTS: { put: mockR2Put } } as unknown as Env;

    const service = new SmsReceiptIntakeService(db, env);
    const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);

    const result = await service.ingestSmsReceipt({
      clientId: "cli_1",
      firmId: "firm_1",
      clientName: "Apex Logistics",
      fileBytes,
      filename: "receipt_photo.jpg",
      mimeType: "image/jpeg",
      senderPhone: "+15552345678",
      smsBody: "Home depot supplies",
      amountHint: 145.2,
    });

    expect(result.success).toBe(true);
    expect(result.matchedBankTransactionId).toBeNull();
    expect(result.satisfiedRequestId).toBeNull();
    expect(mockR2Put).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);

    const transactionStatements = (db.transaction as any).mock.calls[0][0];
    // Statement 1: insert receipt
    expect(transactionStatements[0].query).toContain("INSERT INTO receipts");
    expect(transactionStatements[0].query).toContain("'review'");
    expect(transactionStatements).toHaveLength(2);
    // Statement 2: immutable audit event, not an automatic bank/request update.
    expect(transactionStatements[1].query).toContain("INSERT INTO audit_events");
  });
});
