import { describe, it, expect, vi } from "vitest";
import { IntercompanyMirrorService } from "./intercompany-mirror";
import type { Db } from "../db";

describe("IntercompanyMirrorService", () => {
  function mockDb(queries: { [pattern: string]: any } = {}): Db {
    return {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        for (const [pattern, result] of Object.entries(queries)) {
          if (sql.includes(pattern)) {
            return typeof result === "function" ? (result as Function)(params) : result;
          }
        }
        return [];
      }),
      transaction: vi.fn(async (statements) => {
        return statements.map(() => []);
      }),
    };
  }

  it("detects exact intercompany mirror match between two different entities", async () => {
    const mockTxns = [
      {
        id: "txn_opco_1",
        client_id: "cli_opco",
        client_name: "Acme Operating S-Corp",
        txn_date: "2026-03-10",
        description: "Online Transfer to Acme Real Estate",
        amount: "-5000.00",
        triage: "unmatched",
      },
      {
        id: "txn_re_1",
        client_id: "cli_re",
        client_name: "Acme Real Estate LLC",
        txn_date: "2026-03-11",
        description: "Electronic Deposit - Acme Operating",
        amount: "5000.00",
        triage: "unmatched",
      },
    ];

    const db = mockDb({
      "FROM bank_transactions": mockTxns,
      "CREATE TABLE": [],
    });

    const service = new IntercompanyMirrorService(db);
    const matches = await service.detectMirrorTransactions("firm_123", "cli_opco");

    expect(matches.length).toBe(1);
    const match = matches[0];
    expect(match.amount).toBe(5000);
    expect(match.confidenceScore).toBeGreaterThanOrEqual(90);
    expect(match.matchRating).toBe("high_confidence");
    expect(match.dateDifferenceDays).toBe(1);
    expect(match.source.clientId).toBe("cli_opco");
    expect(match.mirror.clientId).toBe("cli_re");
    expect(match.matchReason).toContain("Exact mirror amount $5000.00");
  });

  it("does not match transactions occurring inside the same client entity", async () => {
    const mockTxns = [
      {
        id: "txn_1",
        client_id: "cli_single",
        client_name: "Solo Business LLC",
        txn_date: "2026-03-10",
        description: "Internal Checking to Savings Transfer",
        amount: "-2000.00",
        triage: "unmatched",
      },
      {
        id: "txn_2",
        client_id: "cli_single",
        client_name: "Solo Business LLC",
        txn_date: "2026-03-10",
        description: "Internal Checking to Savings Transfer",
        amount: "2000.00",
        triage: "unmatched",
      },
    ];

    const db = mockDb({
      "FROM bank_transactions": mockTxns,
      "CREATE TABLE": [],
    });

    const service = new IntercompanyMirrorService(db);
    const matches = await service.detectMirrorTransactions("firm_123", "cli_single");

    expect(matches.length).toBe(0); // must NOT match within same client
  });

  it("assigns intercompany rent classifications when description mentions rent", async () => {
    const mockTxns = [
      {
        id: "txn_rent_out",
        client_id: "cli_tenant",
        client_name: "Apex Logistics Inc",
        txn_date: "2026-04-01",
        description: "April Warehouse Rent Payment",
        amount: "-7500.00",
        triage: "unmatched",
      },
      {
        id: "txn_rent_in",
        client_id: "cli_landlord",
        client_name: "Apex Holdings LLC",
        txn_date: "2026-04-01",
        description: "Wire Deposit Tenant Rent",
        amount: "7500.00",
        triage: "unmatched",
      },
    ];

    const db = mockDb({
      "FROM bank_transactions": mockTxns,
      "CREATE TABLE": [],
    });

    const service = new IntercompanyMirrorService(db);
    const matches = await service.detectMirrorTransactions("firm_123");

    expect(matches.length).toBe(1);
    expect(matches[0].suggestedClassification.sourceCategory).toBe("Intercompany Rent Expense");
    expect(matches[0].suggestedClassification.mirrorCategory).toBe("Intercompany Rental Income");
  });

  it("reconciles both sides atomically and logs an audit event", async () => {
    const db = mockDb({
      "CREATE TABLE": [],
    });

    const service = new IntercompanyMirrorService(db);
    const res = await service.reconcileMirrorMatch("firm_123", "user_cpa", "Phyllis CPA", {
      sourceTxnId: "txn_opco_1",
      sourceClientId: "cli_opco",
      sourceClientName: "Acme Operating S-Corp",
      mirrorTxnId: "txn_re_1",
      mirrorClientId: "cli_re",
      mirrorClientName: "Acme Real Estate LLC",
      amount: 5000,
    });

    expect(res.success).toBe(true);
    expect(res.auditId).toBeTruthy();
    expect(db.transaction).toHaveBeenCalledTimes(1);

    // Verify atomic statements
    const transactionCalls = (db.transaction as any).mock.calls[0][0];
    expect(transactionCalls.length).toBe(4);
    // Statement 1: update source txn
    expect(transactionCalls[0].query).toContain("UPDATE bank_transactions");
    expect(transactionCalls[0].params[0]).toContain("Intercompany transfer to Acme Real Estate LLC");
    // Statement 2: update mirror txn
    expect(transactionCalls[1].query).toContain("UPDATE bank_transactions");
    expect(transactionCalls[1].params[0]).toContain("Intercompany deposit from Acme Operating S-Corp");
    // Statement 3: insert into intercompany_reconciliations
    expect(transactionCalls[2].query).toContain("INSERT INTO intercompany_reconciliations");
    // Statement 4: insert into audit_events
    expect(transactionCalls[3].query).toContain("INSERT INTO audit_events");
  });
});
