import { describe, expect, it } from "vitest";
import { WaveSafeImportService } from "./wave-safe-import";
import type { Db } from "../db";

function memoryDb(): Db {
  const imported = new Set<string>();
  return {
    async query<T>(query: string, params: unknown[] = []): Promise<T[]> {
      if (query.includes("FROM migration_import_records")) {
        return imported.has(String(params[2])) ? [{ id: "mir_existing" } as T] : [];
      }
      if (query.includes("INSERT INTO migration_import_records")) imported.add(String(params[3]));
      return [];
    },
    async transaction(statements) {
      for (const statement of statements) await this.query(statement.query, statement.params);
      return statements.map(() => []);
    },
  };
}

describe("WaveSafeImportService", () => {
  it("imports customer exports once and records the source-to-target mapping", async () => {
    const service = new WaveSafeImportService(memoryDb());
    const first = await service.importCsv({
      firmId: "firm_1",
      sourceType: "customers",
      filename: "Customers.csv",
      csv: "Name,Email,Phone\nAcme,ops@acme.example,555-0100\n",
    });
    expect(first).toMatchObject({ totalRows: 1, createdCount: 1, skippedCount: 0, failedRows: [] });

    const second = await service.importCsv({
      firmId: "firm_1",
      sourceType: "customers",
      filename: "Customers.csv",
      csv: "Name,Email,Phone\nAcme,ops@acme.example,555-0100\n",
    });
    expect(second).toMatchObject({ createdCount: 0, skippedCount: 1, failedRows: [] });
  });

  it("keeps invoices as draft imports and rejects malformed dates per row", async () => {
    const service = new WaveSafeImportService(memoryDb());
    const result = await service.importCsv({
      firmId: "firm_1",
      sourceType: "invoices",
      filename: "Invoices.csv",
      csv: "Invoice Number,Customer Name,Invoice Date,Total\nINV-7,Acme,not-a-date,100.00\n",
    });
    expect(result.createdCount).toBe(0);
    expect(result.failedRows).toEqual([expect.objectContaining({ row: 2, message: expect.stringContaining("Invoice date") })]);
  });
});
