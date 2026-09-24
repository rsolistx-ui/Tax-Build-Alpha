import { describe, expect, it } from "vitest";
import { priorYearChecklistCarryover } from "./documents";
import { seedDefaultTaxFormMappings, suggestTaxFormForEntity } from "./tax-form-mappings";
import type { Db } from "../db";

describe("seedDefaultTaxFormMappings", () => {
  it("seeds a whole form in ONE query (Workers free plan allows 50 subrequests per request)", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return Array.from({ length: 30 }, (_, i) => ({ id: `tfm_${i}` })) as T[];
      },
      async transaction() { return []; },
    } as unknown as Db;
    const seeded = await seedDefaultTaxFormMappings(db, "firm_1", "cli_1", "SchC", 2026);
    expect(calls).toHaveLength(1);
    expect(seeded).toBe(30);
    const { sql, params } = calls[0];
    expect(sql).toContain("ON CONFLICT (firm_id, client_id, tax_form, tax_year, form_line_code) WHERE client_id IS NOT NULL DO NOTHING");
    expect(params.slice(0, 4)).toEqual(["firm_1", "cli_1", "SchC", 2026]);
    // First row: id, then SchC_1 / label / sort order, bound to $5..$8.
    expect(sql).toContain("($5, $1, $2, $3, $4, $6, $7, 'direct', $8, TRUE, NOW(), NOW())");
    expect(params[5]).toBe("SchC_1");
    expect(params[6]).toBe("Gross receipts or sales");
    expect(params[7]).toBe(1);
  });
});

const row = (doc_type: string, status = "received", custom_label: string | null = null) => ({ doc_type, status, custom_label });

describe("priorYearChecklistCarryover", () => {
  it("carries forward last year's documents that are missing this year", () => {
    const out = priorYearChecklistCarryover([row("w2"), row("1099"), row("bank_statements")], [row("w2", "expected")]);
    expect(out).toEqual([{ docType: "1099", customLabel: null }, { docType: "bank_statements", customLabel: null }]);
  });

  it("skips items marked not applicable last year", () => {
    expect(priorYearChecklistCarryover([row("k1", "not_applicable")], [])).toEqual([]);
  });

  it("treats custom items as distinct by label and never duplicates", () => {
    const out = priorYearChecklistCarryover(
      [row("other", "received", "Rental lease"), row("other", "received", "HSA statement"), row("other", "received", "Rental lease")],
      [row("other", "expected", "HSA statement")],
    );
    expect(out).toEqual([{ docType: "other", customLabel: "Rental lease" }]);
  });

  it("returns nothing when there was no prior-year checklist", () => {
    expect(priorYearChecklistCarryover([], [row("w2")])).toEqual([]);
  });
});

describe("suggestTaxFormForEntity", () => {
  it.each([
    ["sole_proprietor", "SchC"],
    ["Sole Proprietor", "SchC"],
    ["LLC", "SchC"],
    ["s_corp", "1120S"],
    ["S-Corp", "1120S"],
    ["c_corp", "1120"],
    ["partnership", "1065"],
    ["individual", "1040"],
    [null, "1040"],
  ])("%s -> %s", (entity, form) => {
    expect(suggestTaxFormForEntity(entity)).toBe(form);
  });
});
