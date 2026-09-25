import { FunctionArgumentType, FunctionPlugin, HyperFormula, type ImplementedFunctions } from 'hyperformula';
import { HYPERFORMULA_LICENSE_KEY } from './hyperformula-license';

export interface TaxFunctionRegistry {
  name: string;
  description: string;
  args: { name: string; type: 'number' | 'string' | 'boolean'; required: boolean; description: string }[];
  returns: 'number' | 'string' | 'boolean';
  category: 'federal' | 'state' | 'carryforward' | 'credit' | 'depreciation' | 'utility';
  implementation: (...args: any[]) => any;
}

function taxMethodName(fnName: string): string {
  return '_fn_' + fnName.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

const HF_ARGUMENT_TYPE: Record<'number' | 'string' | 'boolean', FunctionArgumentType> = {
  number: FunctionArgumentType.NUMBER,
  string: FunctionArgumentType.STRING,
  boolean: FunctionArgumentType.BOOLEAN,
};

class FolioTaxPlugin extends FunctionPlugin {
  dispatch(ast: any, state: any, fn: TaxFunctionRegistry): any {
    return this.runFunction(ast.args, state, this.metadata(fn.name), fn.implementation);
  }
}

export const TAX_FUNCTIONS: TaxFunctionRegistry[] = [
  // Federal 1040 Line Calculations
  {
    name: 'TAX_1040_LINE1',
    description: 'Wages, salaries, tips (W-2 Box 1)',
    args: [{ name: 'w2_wages', type: 'number', required: true, description: 'Total W-2 wages from all employers' }],
    returns: 'number',
    category: 'federal',
    implementation: (w2_wages: number) => w2_wages,
  },
  {
    name: 'TAX_1040_LINE2',
    description: 'Tax-exempt interest',
    args: [{ name: 'tax_exempt_interest', type: 'number', required: true, description: 'Total tax-exempt interest received' }],
    returns: 'number',
    category: 'federal',
    implementation: (tax_exempt_interest: number) => tax_exempt_interest,
  },
  {
    name: 'TAX_1040_LINE3',
    description: 'Qualified dividends',
    args: [{ name: 'qualified_dividends', type: 'number', required: true, description: 'Qualified dividends from 1099-DIV' }],
    returns: 'number',
    category: 'federal',
    implementation: (qualified_dividends: number) => qualified_dividends,
  },
  {
    name: 'TAX_1040_LINE7',
    description: 'Capital gain or (loss) from Schedule D',
    args: [{ name: 'capital_gain_loss', type: 'number', required: true, description: 'Net capital gain/loss from Schedule D' }],
    returns: 'number',
    category: 'federal',
    implementation: (capital_gain_loss: number) => capital_gain_loss,
  },
  {
    name: 'TAX_1040_LINE8',
    description: 'Other income (Schedule 1)',
    args: [{ name: 'other_income', type: 'number', required: true, description: 'Other income from Schedule 1' }],
    returns: 'number',
    category: 'federal',
    implementation: (other_income: number) => other_income,
  },
  {
    name: 'TAX_1040_LINE9',
    description: 'Total income (lines 1-8)',
    args: [
      { name: 'line1', type: 'number', required: true, description: 'Wages from W-2' },
      { name: 'line2', type: 'number', required: false, description: 'Tax-exempt interest' },
      { name: 'line3', type: 'number', required: false, description: 'Qualified dividends' },
      { name: 'line4', type: 'number', required: false, description: 'IRA deductions' },
      { name: 'line5', type: 'number', required: false, description: 'Student loan interest' },
      { name: 'line6', type: 'number', required: false, description: 'Educator expenses' },
      { name: 'line7', type: 'number', required: false, description: 'Capital gains/losses' },
      { name: 'line8', type: 'number', required: false, description: 'Other income from Schedule 1' },
    ],
    returns: 'number',
    category: 'federal',
    implementation: (line1: number, line2 = 0, line3 = 0, line4 = 0, line5 = 0, line6 = 0, line7 = 0, line8 = 0) =>
      line1 + line2 + line3 + line4 + line5 + line6 + line7 + line8,
  },

  // Standard Deduction (2024)
  {
    name: 'TAX_1040_STANDARD_DEDUCTION',
    description: 'Standard deduction based on filing status and age',
    args: [
      { name: 'filing_status', type: 'string', required: true, description: 'single, married_filing_jointly, married_filing_separately, head_of_household, qualifying_widow' },
      { name: 'age_taxpayer', type: 'number', required: false, description: 'Age of taxpayer (for 65+ additional)' },
      { name: 'age_spouse', type: 'number', required: false, description: 'Age of spouse (for 65+ additional, MFJ only)' },
      { name: 'blind_taxpayer', type: 'boolean', required: false, description: 'Taxpayer is blind' },
      { name: 'blind_spouse', type: 'boolean', required: false, description: 'Spouse is blind' },
    ],
    returns: 'number',
    category: 'federal',
    implementation: (filing_status: string, age_taxpayer = 0, age_spouse = 0, blind_taxpayer = false, blind_spouse = false) => {
      const base: Record<string, number> = {
        single: 14600,
        married_filing_jointly: 29200,
        married_filing_separately: 14600,
        head_of_household: 21900,
        qualifying_widow: 29200,
      };
      let deduction = base[filing_status] || 14600;
      const additional = 1550; // 2024 additional for 65+ or blind
      if (age_taxpayer >= 65) deduction += additional;
      if (blind_taxpayer) deduction += additional;
      if (['married_filing_jointly', 'qualifying_widow'].includes(filing_status)) {
        if (age_spouse >= 65) deduction += additional;
        if (blind_spouse) deduction += additional;
      }
      return deduction;
    },
  },

  // 2024 Tax Brackets
  {
    name: 'TAX_1040_TAX_LIABILITY',
    description: 'Calculate tax liability using 2024 brackets',
    args: [
      { name: 'taxable_income', type: 'number', required: true, description: 'Taxable income after deductions' },
      { name: 'filing_status', type: 'string', required: true, description: 'single, married_filing_jointly, married_filing_separately, head_of_household' },
    ],
    returns: 'number',
    category: 'federal',
    implementation: (taxable_income: number, filing_status: string) => {
      if (taxable_income <= 0) return 0;

      const brackets: Record<string, Array<{ min: number; max: number; rate: number; base: number }>> = {
        single: [
          { min: 0, max: 11600, rate: 0.10, base: 0 },
          { min: 11600, max: 47150, rate: 0.12, base: 1160 },
          { min: 47150, max: 100525, rate: 0.22, base: 5426 },
          { min: 100525, max: 191950, rate: 0.24, base: 17168.5 },
          { min: 191950, max: 243725, rate: 0.32, base: 39110.5 },
          { min: 243725, max: 609350, rate: 0.35, base: 55678.5 },
          { min: 609350, max: Infinity, rate: 0.37, base: 183647.25 },
        ],
        married_filing_jointly: [
          { min: 0, max: 23200, rate: 0.10, base: 0 },
          { min: 23200, max: 94300, rate: 0.12, base: 2320 },
          { min: 94300, max: 201050, rate: 0.22, base: 10852 },
          { min: 201050, max: 383900, rate: 0.24, base: 33537 },
          { min: 383900, max: 487450, rate: 0.32, base: 77101 },
          { min: 487450, max: 731200, rate: 0.35, base: 105664 },
          { min: 731200, max: Infinity, rate: 0.37, base: 191724 },
        ],
        married_filing_separately: [
          { min: 0, max: 11600, rate: 0.10, base: 0 },
          { min: 11600, max: 47150, rate: 0.12, base: 1160 },
          { min: 47150, max: 100525, rate: 0.22, base: 5426 },
          { min: 100525, max: 191950, rate: 0.24, base: 17168.5 },
          { min: 191950, max: 243725, rate: 0.32, base: 39110.5 },
          { min: 243725, max: 365600, rate: 0.35, base: 55678.5 },
          { min: 365600, max: Infinity, rate: 0.37, base: 95937.25 },
        ],
        head_of_household: [
          { min: 0, max: 16550, rate: 0.10, base: 0 },
          { min: 16550, max: 63100, rate: 0.12, base: 1655 },
          { min: 63100, max: 100500, rate: 0.22, base: 7241 },
          { min: 100500, max: 191950, rate: 0.24, base: 15527 },
          { min: 191950, max: 243700, rate: 0.32, base: 37579 },
          { min: 243700, max: 609350, rate: 0.35, base: 54450.5 },
          { min: 609350, max: Infinity, rate: 0.37, base: 183622 },
        ],
      };

      const bracket = brackets[filing_status] || brackets.single;
      for (const b of bracket) {
        if (taxable_income <= b.max) {
          return b.base + (taxable_income - b.min) * b.rate;
        }
      }
      // Top bracket
      const top = bracket[bracket.length - 1];
      return top.base + (taxable_income - top.min) * top.rate;
    },
  },

  // Section 179 Deduction
  {
    name: 'TAX_SECTION179_LIMIT',
    description: 'Section 179 deduction limit (2024: $1.22M, phaseout $3.05M)',
    args: [
      { name: 'total_cost', type: 'number', required: true, description: 'Total qualifying property placed in service' },
      { name: 'taxable_income', type: 'number', required: true, description: 'Taxable income from active trade or business' },
    ],
    returns: 'number',
    category: 'depreciation',
    implementation: (total_cost: number, taxable_income: number) => {
      const LIMIT = 1220000;
      const PHASEOUT = 3050000;
      let deduction = Math.min(total_cost, LIMIT);
      if (total_cost > PHASEOUT) {
        deduction = Math.max(0, LIMIT - (total_cost - PHASEOUT));
      }
      return Math.min(deduction, taxable_income);
    },
  },

  // Bonus Depreciation
  {
    name: 'TAX_BONUS_DEPRECIATION',
    description: 'Bonus depreciation percentage (2024: 60%, 2025: 40%, 2026: 20%, 2026: 0%)',
    args: [
      { name: 'year', type: 'number', required: true, description: 'Tax year the asset was placed in service' },
      { name: 'cost', type: 'number', required: true, description: 'Qualifying property cost' },
    ],
    returns: 'number',
    category: 'depreciation',
    implementation: (year: number, cost: number) => {
      const rates: Record<number, number> = { 2023: 1.0, 2024: 0.6, 2025: 0.4, 2026: 0.2, 2027: 0 };
      return cost * (rates[year] || 0);
    },
  },

  // MACRS Depreciation
  {
    name: 'TAX_MACRS_DEPRECIATION',
    description: 'MACRS depreciation for given year',
    args: [
      { name: 'cost', type: 'number', required: true, description: 'Asset cost placed in service' },
      { name: 'recovery_period', type: 'number', required: true, description: '3, 5, 7, 10, 15, 20' },
      { name: 'year', type: 'number', required: true, description: 'Year of recovery (1-based)' },
    ],
    returns: 'number',
    category: 'depreciation',
    implementation: (cost: number, recovery_period: number, year: number) => {
      // Simplified MACRS percentages (half-year convention)
      const rates: Record<number, number[]> = {
        3: [33.33, 44.45, 14.81, 7.41],
        5: [20.00, 32.00, 19.20, 11.52, 11.52, 5.76],
        7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
        10: [10.00, 18.00, 14.40, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
        15: [5.00, 9.50, 8.55, 7.70, 6.93, 6.23, 5.90, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 2.95],
        20: [3.750, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 2.231],
      };
      const pct = rates[recovery_period]?.[year - 1] || 0;
      return cost * (pct / 100);
    },
  },

  // Qualified Business Income Deduction (§199A)
  {
    name: 'TAX_QBI_DEDUCTION',
    description: 'Qualified Business Income deduction (20% of QBI, subject to limits)',
    args: [
      { name: 'qbi', type: 'number', required: true, description: 'Qualified business income' },
      { name: 'taxable_income', type: 'number', required: true, description: 'Taxable income before the QBI deduction' },
      { name: 'filing_status', type: 'string', required: true, description: 'single, married_filing_jointly, married_filing_separately, head_of_household' },
      { name: 'w2_wages', type: 'number', required: false, description: 'W-2 wages allocated to the trade or business' },
      { name: 'ubiA', type: 'number', required: false, description: 'Unadjusted basis immediately after acquisition of qualified property' },
      { name: 'is_sstb', type: 'boolean', required: false, description: 'Specified Service Trade or Business' },
    ],
    returns: 'number',
    category: 'credit',
    implementation: (qbi: number, taxable_income: number, filing_status: string, w2_wages = 0, ubiA = 0, is_sstb = false) => {
      if (qbi <= 0) return 0;

      const thresholds: Record<string, { phaseout_start: number; phaseout_end: number }> = {
        single: { phaseout_start: 182100, phaseout_end: 232100 },
        married_filing_jointly: { phaseout_start: 364200, phaseout_end: 464200 },
        married_filing_separately: { phaseout_start: 182100, phaseout_end: 232100 },
        head_of_household: { phaseout_start: 182100, phaseout_end: 232100 },
      };

      const threshold = thresholds[filing_status] || thresholds.single;
      let deduction = qbi * 0.2;

      // Phaseout for SSTB or high income
      if (is_sstb || taxable_income > threshold.phaseout_start) {
        const phaseout_range = threshold.phaseout_end - threshold.phaseout_start;
        const excess = Math.max(0, taxable_income - threshold.phaseout_start);
        const phaseout_pct = Math.min(1, excess / phaseout_range);
        deduction *= (1 - phaseout_pct);
      }

      // W-2 wage / UBIA limitation
      const wage_limit = Math.max(w2_wages * 0.5, w2_wages * 0.25 + ubiA * 0.025);
      return Math.min(deduction, wage_limit);
    },
  },

  // Self-Employment Tax
  {
    name: 'TAX_SE_TAX',
    description: 'Self-employment tax (15.3% on 92.35% of net earnings, up to wage base)',
    args: [
      { name: 'net_earnings', type: 'number', required: true, description: 'Net self-employment earnings' },
    ],
    returns: 'number',
    category: 'federal',
    implementation: (net_earnings: number) => {
      if (net_earnings <= 0) return 0;
      const wage_base = 184500; // 2026 Social Security wage base (ssa.gov)
      const taxable = Math.min(net_earnings * 0.9235, wage_base);
      return taxable * 0.124 + net_earnings * 0.9235 * 0.029;
    },
  },

  // State: California
  {
    name: 'STATE_CA_TAX',
    description: 'California state income tax (2024 brackets)',
    args: [
      { name: 'taxable_income', type: 'number', required: true, description: 'Taxable income after deductions' },
      { name: 'filing_status', type: 'string', required: true, description: 'single or married_filing_jointly' },
    ],
    returns: 'number',
    category: 'state',
    implementation: (taxable_income: number, filing_status: string) => {
      if (taxable_income <= 0) return 0;
      const brackets: Record<string, Array<{ max: number; rate: number }>> = {
        single: [
          { max: 10099, rate: 0.01 },
          { max: 23942, rate: 0.02 },
          { max: 37788, rate: 0.04 },
          { max: 52455, rate: 0.06 },
          { max: 66295, rate: 0.08 },
          { max: 338639, rate: 0.093 },
          { max: 406364, rate: 0.103 },
          { max: 677275, rate: 0.113 },
          { max: 1000000, rate: 0.123 },
          { max: Infinity, rate: 0.133 },
        ],
        married_filing_jointly: [
          { max: 20198, rate: 0.01 },
          { max: 47884, rate: 0.02 },
          { max: 75576, rate: 0.04 },
          { max: 104910, rate: 0.06 },
          { max: 132590, rate: 0.08 },
          { max: 677278, rate: 0.093 },
          { max: 812728, rate: 0.103 },
          { max: 1354550, rate: 0.113 },
          { max: 2000000, rate: 0.123 },
          { max: Infinity, rate: 0.133 },
        ],
      };
      const bracket = brackets[filing_status] || brackets.single;
      let tax = 0;
      let prev_max = 0;
      for (const b of bracket) {
        const taxable = Math.min(taxable_income, b.max) - prev_max;
        if (taxable > 0) tax += taxable * b.rate;
        prev_max = b.max;
        if (taxable_income <= b.max) break;
      }
      return tax;
    },
  },

  // State: New York
  {
    name: 'STATE_NY_TAX',
    description: 'New York state income tax (2024 brackets)',
    args: [
      { name: 'taxable_income', type: 'number', required: true, description: 'Taxable income after deductions' },
      { name: 'filing_status', type: 'string', required: true, description: 'single or married_filing_jointly' },
    ],
    returns: 'number',
    category: 'state',
    implementation: (taxable_income: number, filing_status: string) => {
      if (taxable_income <= 0) return 0;
      const brackets: Record<string, Array<{ max: number; rate: number }>> = {
        single: [
          { max: 8500, rate: 0.04 },
          { max: 11700, rate: 0.045 },
          { max: 13900, rate: 0.0525 },
          { max: 21400, rate: 0.059 },
          { max: 80650, rate: 0.0685 },
          { max: 215400, rate: 0.0965 },
          { max: 1077550, rate: 0.103 },
          { max: 5000000, rate: 0.109 },
          { max: 25000000, rate: 0.109 },
          { max: Infinity, rate: 0.109 },
        ],
        married_filing_jointly: [
          { max: 17150, rate: 0.04 },
          { max: 23400, rate: 0.045 },
          { max: 27900, rate: 0.0525 },
          { max: 43000, rate: 0.059 },
          { max: 161550, rate: 0.0685 },
          { max: 323200, rate: 0.0965 },
          { max: 2155350, rate: 0.103 },
          { max: 5000000, rate: 0.109 },
          { max: 25000000, rate: 0.109 },
          { max: Infinity, rate: 0.109 },
        ],
      };
      const bracket = brackets[filing_status] || brackets.single;
      let tax = 0;
      let prev_max = 0;
      for (const b of bracket) {
        const taxable = Math.min(taxable_income, b.max) - prev_max;
        if (taxable > 0) tax += taxable * b.rate;
        prev_max = b.max;
        if (taxable_income <= b.max) break;
      }
      return tax;
    },
  },

  // Utility: Round to cents
  {
    name: 'TAX_ROUND',
    description: 'Round to nearest cent (bankers rounding)',
    args: [{ name: 'value', type: 'number', required: true, description: 'Number to round' }],
    returns: 'number',
    category: 'utility',
    implementation: (value: number) => Math.round(value * 100) / 100,
  },

  // Carryforward Utilization
  {
    name: 'TAX_CARRYFORWARD_UTILIZE',
    description: 'Calculate carryforward utilization with ordering rules',
    args: [
      { name: 'available', type: 'number', required: true, description: 'Available carryforward amount' },
      { name: 'limit', type: 'number', required: true, description: 'Deduction limit for the current year' },
    ],
    returns: 'number',
    category: 'carryforward',
    implementation: (available: number, limit: number) => Math.min(available, limit),
  },
];

const folioImplementedFunctions: ImplementedFunctions = {};
const folioTaxPrototype = FolioTaxPlugin.prototype as unknown as Record<string, (this: FolioTaxPlugin, ast: any, state: any) => any>;
for (const fn of TAX_FUNCTIONS) {
  const method = taxMethodName(fn.name);
  folioImplementedFunctions[fn.name] = {
    method,
    parameters: fn.args.map(arg => ({
      argumentType: HF_ARGUMENT_TYPE[arg.type],
      optionalArg: !arg.required,
    })),
  };
  folioTaxPrototype[method] = function (ast, state) {
    return this.dispatch(ast, state, fn);
  };
}
FolioTaxPlugin.implementedFunctions = folioImplementedFunctions;

const taxFunctionTranslations: Record<string, string> = Object.fromEntries(TAX_FUNCTIONS.map(fn => [fn.name, fn.name]));

HyperFormula.registerFunctionPlugin(FolioTaxPlugin, {
  enGB: taxFunctionTranslations,
});

export function createTaxFunctionEngine(): HyperFormula {
  return HyperFormula.buildFromSheets(
    { 'TaxFunctions': [['']] },
    {
      licenseKey: HYPERFORMULA_LICENSE_KEY,
      useColumnIndex: false,
    }
  );
}

export function evaluateTaxFormula(hf: HyperFormula, sheetIdx: number, cell: string, formula: string): any {
  const match = cell.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = match[1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const row = parseInt(match[2], 10) - 1;
  const addr = { col, row, sheet: sheetIdx };
  hf.setCellContents(addr, formula);
  return hf.getCellValue(addr);
}

export function batchEvaluateTaxFormulas(hf: HyperFormula, sheetIdx: number, formulas: Record<string, string>): Record<string, any> {
  const results: Record<string, any> = {};
  for (const [cell, formula] of Object.entries(formulas)) {
    const match = cell.match(/^([A-Z]+)(\d+)$/);
    if (!match) { results[cell] = null; continue; }
    const col = match[1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const row = parseInt(match[2], 10) - 1;
    const addr = { col, row, sheet: sheetIdx };
    hf.setCellContents(addr, formula);
    results[cell] = hf.getCellValue(addr);
  }
  return results;
}
