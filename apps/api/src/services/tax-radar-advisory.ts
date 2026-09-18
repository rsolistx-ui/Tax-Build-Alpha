import type { Db } from "../db";
import { newId } from "../lib/id";

export interface Contractor1099Item {
  contractorName: string;
  totalPaid: number;
  hasW9: boolean;
  einSsnLast4: string | null;
  needs1099: boolean;
  status: "ready_to_file" | "missing_w9" | "under_threshold";
  suggestedAction: string;
}

export interface SCorpSavingsAnalysis {
  netProfit: number;
  solePropSeTax: number;
  sCorpReasonableSalary: number;
  sCorpDistribution: number;
  sCorpPayrollTax: number;
  grossTaxSavings: number;
  estimatedAdminCost: number;
  netAnnualSavings: number;
  isRecommended: boolean;
  advisorySummary: string;
}

export class TaxRadarAdvisoryService {
  constructor(private db: Db) {}

  /**
   * 1099 Radar: Scans all payments to vendors for a client to identify contractors
   * crossing the IRS $600 threshold, cross-referencing W-9 collection status.
   */
  async scan1099Radar(firmId: string, clientId: string): Promise<Contractor1099Item[]> {
    // 1. Fetch vendor totals from bank transactions classified as business expense
    const bankVendors = await this.db.query<{ payee: string; total: number }>(
      `SELECT description AS payee, SUM(ABS(amount))::numeric AS total
       FROM bank_transactions
       WHERE client_id = $1 AND disposition = 'business_expense'
       GROUP BY description`,
      [clientId]
    );

    // 2. Fetch vendor totals from receipts
    const receiptVendors = await this.db.query<{ payee: string; total: number }>(
      `SELECT COALESCE(extracted_merchant, filename) AS payee, SUM(COALESCE(extracted_total, 0))::numeric AS total
       FROM receipts
       WHERE client_id = $1 AND status = 'filed'
       GROUP BY COALESCE(extracted_merchant, filename)`,
      [clientId]
    );

    // 3. Fetch W-9 records on file
    const w9Records = await this.db.query<{
      contractor_name: string;
      has_w9: boolean;
      ein_ssn_last4: string | null;
    }>(
      `SELECT contractor_name, has_w9, ein_ssn_last4
       FROM contractor_w9_records
       WHERE client_id = $1`,
      [clientId]
    );

    const w9Map = new Map(w9Records.map((r) => [r.contractor_name.toLowerCase().trim(), r]));

    // Aggregate totals by normalized contractor name
    const totals = new Map<string, number>();
    for (const row of [...bankVendors, ...receiptVendors]) {
      const name = (row.payee || "").trim();
      if (!name) continue;
      // Skip known utility/corporate non-1099 vendors
      const lower = name.toLowerCase();
      if (
        lower.includes("shell") ||
        lower.includes("exxon") ||
        lower.includes("chevron") ||
        lower.includes("homedepot") ||
        lower.includes("home depot") ||
        lower.includes("lowe's") ||
        lower.includes("amazon") ||
        lower.includes("apple") ||
        lower.includes("staples") ||
        lower.includes("walmart") ||
        lower.includes("target")
      ) {
        continue;
      }

      totals.set(name, (totals.get(name) || 0) + Number(row.total || 0));
    }

    const items: Contractor1099Item[] = [];
    for (const [name, total] of totals.entries()) {
      if (total < 100) continue; // Only surface vendors with meaningful activity

      const w9 = w9Map.get(name.toLowerCase());
      const hasW9 = Boolean(w9?.has_w9);
      const einSsnLast4 = w9?.ein_ssn_last4 || null;
      const needs1099 = total >= 600;

      let status: Contractor1099Item["status"] = "under_threshold";
      let suggestedAction = "Monitor payments towards $600 limit";

      if (needs1099) {
        if (hasW9) {
          status = "ready_to_file";
          suggestedAction = "W-9 on file. Ready for Form 1099-NEC preparation.";
        } else {
          status = "missing_w9";
          suggestedAction = "Exceeded $600 threshold. Request Form W-9 before year-end.";
        }
      }

      items.push({
        contractorName: name,
        totalPaid: Math.round(total * 100) / 100,
        hasW9,
        einSsnLast4,
        needs1099,
        status,
        suggestedAction,
      });
    }

    // Sort by largest payment first
    return items.sort((a, b) => b.totalPaid - a.totalPaid);
  }

  /**
   * Save or update W-9 collection status for a contractor.
   */
  async updateContractorW9(
    firmId: string,
    clientId: string,
    input: { contractorName: string; hasW9: boolean; einSsnLast4?: string; email?: string }
  ) {
    const id = newId("w9");
    await this.db.query(
      `INSERT INTO contractor_w9_records (id, firm_id, client_id, contractor_name, has_w9, ein_ssn_last4, email, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (client_id, contractor_name) DO UPDATE SET
         has_w9 = EXCLUDED.has_w9,
         ein_ssn_last4 = COALESCE(EXCLUDED.ein_ssn_last4, contractor_w9_records.ein_ssn_last4),
         email = COALESCE(EXCLUDED.email, contractor_w9_records.email),
         updated_at = NOW()`,
      [id, firmId, clientId, input.contractorName.trim(), input.hasW9, input.einSsnLast4 || null, input.email || null]
    );
  }

  /**
   * S-Corp Optimizer: Analyzes sole proprietorship Schedule C net profit against
   * an S-Corporation election (Form 2553) to project annual self-employment tax savings.
   */
  calculateSCorpSavings(netProfit: number): SCorpSavingsAnalysis {
    if (netProfit <= 0) {
      return {
        netProfit: 0,
        solePropSeTax: 0,
        sCorpReasonableSalary: 0,
        sCorpDistribution: 0,
        sCorpPayrollTax: 0,
        grossTaxSavings: 0,
        estimatedAdminCost: 0,
        netAnnualSavings: 0,
        isRecommended: false,
        advisorySummary: "Client currently has zero or negative taxable net profit. S-Corp election not recommended at this time.",
      };
    }

    // Sole Prop SE tax: 15.3% on 92.35% of net profit (up to Social Security wage base ~$168,600)
    const seTaxableBase = netProfit * 0.9235;
    const ssCap = 168600;
    const seSsTax = Math.min(seTaxableBase, ssCap) * 0.124;
    const seMedTax = seTaxableBase * 0.029;
    const solePropSeTax = Math.round(seSsTax + seMedTax);

    // S-Corp Strategy: 60% Reasonable Officer Salary, 40% Shareholder Distribution
    const salaryPct = 0.6;
    const reasonableSalary = Math.round(netProfit * salaryPct);
    const distribution = netProfit - reasonableSalary;

    // S-Corp FICA only applies to the salary portion
    const sCorpSsTax = Math.min(reasonableSalary, ssCap) * 0.124;
    const sCorpMedTax = reasonableSalary * 0.029;
    const sCorpPayrollTax = Math.round(sCorpSsTax + sCorpMedTax);

    // Gross Self-Employment Tax Savings
    const grossTaxSavings = Math.max(0, solePropSeTax - sCorpPayrollTax);

    // Estimated annual administrative cost (Form 1120-S preparation + payroll service)
    const estimatedAdminCost = 1500;
    const netAnnualSavings = Math.max(0, grossTaxSavings - estimatedAdminCost);

    const isRecommended = netProfit >= 60000 && netAnnualSavings >= 1800;

    let advisorySummary = `With $${netProfit.toLocaleString()} in net profit, remaining as a Sole Proprietorship triggers approximately $${solePropSeTax.toLocaleString()} in Self-Employment Tax.`;
    if (isRecommended) {
      advisorySummary += ` By electing S-Corporation status (IRS Form 2553) and paying a reasonable salary of $${reasonableSalary.toLocaleString()}, the client can take $${distribution.toLocaleString()} as distributions free from self-employment taxes, netting an estimated $${netAnnualSavings.toLocaleString()} in annual tax savings after payroll and compliance costs.`;
    } else {
      advisorySummary += ` S-Corp election is generally most cost-effective when net profit consistently exceeds $60,000/year to outweigh administrative and payroll filing costs.`;
    }

    return {
      netProfit,
      solePropSeTax,
      sCorpReasonableSalary: reasonableSalary,
      sCorpDistribution: distribution,
      sCorpPayrollTax,
      grossTaxSavings,
      estimatedAdminCost,
      netAnnualSavings,
      isRecommended,
      advisorySummary,
    };
  }
}
