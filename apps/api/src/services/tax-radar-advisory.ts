import type { Db } from "../db";
import { newId } from "../lib/id";

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

    // Sole Prop SE tax: 15.3% on 92.35% of net profit (up to the 2026 Social Security wage base, $184,500 per ssa.gov)
    const seTaxableBase = netProfit * 0.9235;
    const ssCap = 184500;
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
