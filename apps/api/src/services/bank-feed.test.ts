import { describe, expect, it, vi } from "vitest";
import { BankAccountService } from "./bank-feed";

const accountRow = {
  id: "acct_1", connection_id: "conn_1", provider_account_id: "provider_1",
  name: "Operating", official_name: null, type: "checking", subtype: "checking",
  mask: "1234", current_balance: "10.00", available_balance: "9.00", currency: "USD",
  status: "active", is_visible: true, created_at: "2026-09-22T00:00:00.000Z", updated_at: "2026-09-22T00:00:00.000Z",
};

describe("BankAccountService", () => {
  it("updates only explicitly allowed account settings using the supplied account id", async () => {
    const query = vi.fn().mockResolvedValue([accountRow]);
    const service = new BankAccountService({ query, transaction: vi.fn() } as any);

    const result = await service.updateAccount("acct_1", { isVisible: false, name: "Operating checking" });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("UPDATE bank_accounts SET is_visible = $2, name = $3, updated_at = NOW() WHERE id = $1");
    expect(params).toEqual(["acct_1", false, "Operating checking"]);
    expect(result?.id).toBe("acct_1");
  });

  it("requires the connection to belong to the firm when looking up an account", async () => {
    const query = vi.fn().mockResolvedValue([accountRow]);
    const service = new BankAccountService({ query, transaction: vi.fn() } as any);

    const result = await service.getAccountForFirm("acct_1", "firm_1");

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("JOIN bank_connections c ON c.id = a.connection_id");
    expect(params).toEqual(["acct_1", "firm_1"]);
    expect(result?.connectionId).toBe("conn_1");
  });
});
