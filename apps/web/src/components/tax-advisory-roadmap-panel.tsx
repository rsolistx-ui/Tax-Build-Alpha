import { useEffect, useState } from "react";
import {
  Sparkles,
  Landmark,
  Home,
  PiggyBank,
  Truck,
  CheckCircle2,
  Printer,
  Copy,
  Check,
  RefreshCw,
  FileCheck2,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatters";

export interface SCorpOptResult {
  strategyId: "scorp_recomp";
  strategyTitle: string;
  isApplicable: boolean;
  netProfit: number;
  solePropSeTax: number;
  recommendedSalary: number;
  recommendedDistribution: number;
  sCorpPayrollTax: number;
  grossFicaSavings: number;
  estimatedAdminComplianceCost: number;
  netAnnualSavings: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface AugustaRuleResult {
  strategyId: "augusta_rule";
  strategyTitle: string;
  isApplicable: boolean;
  daysRented: number;
  dailyRate: number;
  totalTaxFreeIncome: number;
  corporateTaxSavings: number;
  ownerPersonalSavings: number;
  totalAnnualSavings: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface RetirementMaximizerResult {
  strategyId: "retirement_shelter";
  strategyTitle: string;
  isApplicable: boolean;
  ownerAge: number;
  employeeElectiveDeferral: number;
  employerProfitSharing: number;
  totalSolo401kContribution: number;
  cashBalanceEligible: boolean;
  cashBalanceContribution: number;
  totalRetirementDeduction: number;
  estimatedTaxSavings: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface Section179Result {
  strategyId: "section_179";
  strategyTitle: string;
  isApplicable: boolean;
  qualifyingAssetPurchases: number;
  section179Deduction: number;
  firstYearBonusDepreciation: number;
  totalFirstYearDeduction: number;
  firstYearTaxSavings: number;
  standardMacrsComparison: number;
  immediateCashAdvantage: number;
  ircAuthority: string;
  implementationRoadmap: string[];
  rationale: string;
}

export interface TaxAdvisoryRoadmap {
  generatedAt: string;
  clientId: string;
  clientName: string;
  taxYear: number;
  baselineNetProfit: number;
  effectiveTaxBracketPercent: number;
  totalEstimatedAnnualSavings: number;
  executiveSummary: string;
  strategies: {
    scorpOpt: SCorpOptResult;
    augustaRule: AugustaRuleResult;
    retirementShelter: RetirementMaximizerResult;
    section179: Section179Result;
  };
  actionChecklist: {
    phase: "immediate_30_days" | "mid_year" | "year_end_filing";
    title: string;
    description: string;
    statutoryRef: string;
  }[];
  circular230AdvisoryNotice: string;
}

interface AdvisoryResponse {
  roadmap: TaxAdvisoryRoadmap;
  clientName: string;
  legalName?: string | null;
  entityType?: string | null;
  industry?: string | null;
}

export function TaxAdvisoryRoadmapPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<AdvisoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live Scenario Tuning Parameters
  const [marginalBracket, setMarginalBracket] = useState<number>(0.28);
  const [ownerAge, setOwnerAge] = useState<number>(45);
  const [hoursPerWeek, setHoursPerWeek] = useState<number>(40);
  const [augustaDays, setAugustaDays] = useState<number>(12);
  const [augustaDailyRate, setAugustaDailyRate] = useState<number>(1250);
  const [plannedEquipment, setPlannedEquipment] = useState<number>(0);
  const [heavyVehicles, setHeavyVehicles] = useState<number>(0);

  const [expandedStrategy, setExpandedStrategy] = useState<string | null>("scorp_recomp");
  const [loggingAudit, setLoggingAudit] = useState(false);
  const [auditLogged, setAuditLogged] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<Date | null>(null);

  async function loadRoadmap() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        marginalTaxBracket: String(marginalBracket),
        ownerAge: String(ownerAge),
        hoursWorkedPerWeek: String(hoursPerWeek),
        augustaDays: String(augustaDays),
        augustaDailyRate: String(augustaDailyRate),
        plannedEquipmentPurchases: String(plannedEquipment),
        heavyVehiclePurchases: String(heavyVehicles),
      });

      const res = await api<AdvisoryResponse>(`/api/clients/${clientId}/advisory-roadmap?${params.toString()}`);
      setData(res);
      setLastEvaluatedAt(new Date());
    } catch (e: any) {
      setError(e?.message || "Failed to generate Tax Advisory Strategy Roadmap.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRoadmap();
  }, [clientId, marginalBracket, ownerAge, hoursPerWeek, augustaDays, augustaDailyRate, plannedEquipment, heavyVehicles]);

  async function handleLogAudit() {
    if (!data?.roadmap) return;
    setLoggingAudit(true);
    try {
      await api(`/api/clients/${clientId}/advisory-roadmap/log`, {
        method: "POST",
        body: JSON.stringify({
          taxYear: data.roadmap.taxYear,
          totalEstimatedSavings: data.roadmap.totalEstimatedAnnualSavings,
          memoSummary: data.roadmap.executiveSummary,
        }),
      });
      setAuditLogged(true);
      setTimeout(() => setAuditLogged(false), 4000);
    } catch (e: any) {
      alert("Failed to log advisory roadmap: " + (e?.message || "Unknown error"));
    } finally {
      setLoggingAudit(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  function copyRoadmapText() {
    if (!data?.roadmap) return;
    const r = data.roadmap;
    const text = `===============================================================
TRUEPOST EXECUTIVE TAX ADVISORY ROADMAP
Client: ${r.clientName} | Tax Year: ${r.taxYear}
Total Estimated Annual Tax Savings: $${r.totalEstimatedAnnualSavings.toLocaleString()}
===============================================================

EXECUTIVE SUMMARY:
${r.executiveSummary}

STRATEGY 1: S-CORPORATION REASONABLE COMPENSATION OPTIMIZER
- Recommended Officer W-2 Salary: $${r.strategies.scorpOpt.recommendedSalary.toLocaleString()}
- Protected Shareholder Distributions: $${r.strategies.scorpOpt.recommendedDistribution.toLocaleString()}
- Net Annual FICA Savings: $${r.strategies.scorpOpt.netAnnualSavings.toLocaleString()}
- Authority: ${r.strategies.scorpOpt.ircAuthority}

STRATEGY 2: AUGUSTA RULE (IRC § 280A(g)) HOME RENTAL
- Qualified Meeting Days: ${r.strategies.augustaRule.daysRented} days @ $${r.strategies.augustaRule.dailyRate.toLocaleString()}/day
- Tax-Free Income to Owner: $${r.strategies.augustaRule.totalTaxFreeIncome.toLocaleString()}
- Total Income Tax Saved: $${r.strategies.augustaRule.totalAnnualSavings.toLocaleString()}
- Authority: ${r.strategies.augustaRule.ircAuthority}

STRATEGY 3: SOLO 401(K) & DEFINED BENEFIT RETIREMENT SHELTER
- Employee Elective Deferral: $${r.strategies.retirementShelter.employeeElectiveDeferral.toLocaleString()}
- Employer Profit Sharing: $${r.strategies.retirementShelter.employerProfitSharing.toLocaleString()}
- Cash Balance Defined Benefit Plan: $${r.strategies.retirementShelter.cashBalanceContribution.toLocaleString()}
- Total Retirement Tax Deduction: $${r.strategies.retirementShelter.totalRetirementDeduction.toLocaleString()}
- Estimated Tax Savings: $${r.strategies.retirementShelter.estimatedTaxSavings.toLocaleString()}
- Authority: ${r.strategies.retirementShelter.ircAuthority}

STRATEGY 4: SECTION 179 ACCELERATED DEPRECIATION
- Qualifying Capital Purchases: $${r.strategies.section179.qualifyingAssetPurchases.toLocaleString()}
- Immediate First-Year Deduction: $${r.strategies.section179.totalFirstYearDeduction.toLocaleString()}
- Immediate Tax Savings: $${r.strategies.section179.firstYearTaxSavings.toLocaleString()}
- Authority: ${r.strategies.section179.ircAuthority}

${r.circular230AdvisoryNotice}
`;
    navigator.clipboard.writeText(text);
    setCopiedMemo(true);
    setTimeout(() => setCopiedMemo(false), 3000);
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-3">
        <RefreshCw className="h-7 w-7 animate-spin text-emerald-600" />
        <p className="text-sm font-medium text-[var(--color-muted-foreground)]">
          Synthesizing high-leverage tax advisory roadmap from reconciled ledger...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-3">
        <p className="text-sm font-medium text-rose-700 dark:text-rose-400">{error || "No advisory data available."}</p>
        <Button size="sm" variant="outline" onClick={loadRoadmap}>
          Retry Generation
        </Button>
      </div>
    );
  }

  const { roadmap, clientName, entityType, industry } = data;
  const { scorpOpt, augustaRule, retirementShelter, section179 } = roadmap.strategies;

  return (
    <div className="space-y-6">
      {/* Action Header (Hidden in Print) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--color-foreground)] flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              Executive Tax Advisory Strategy Roadmap
            </h2>
            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
              High-Value Advisory Engagements
            </Badge>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            Bespoke strategic tax blueprint for {clientName} ({roadmap.taxYear} Tax Year · {industry || "General Business"} · {entityType || "Unincorporated"}).
            {lastEvaluatedAt ? ` · Generated ${formatDateTime(lastEvaluatedAt)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copyRoadmapText} className="text-xs h-8 gap-1.5">
            {copiedMemo ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedMemo ? "Copied Roadmap" : "Copy Dossier"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleLogAudit}
            disabled={loggingAudit}
            className="text-xs h-8 gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
          >
            {auditLogged ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <FileCheck2 className="h-3.5 w-3.5" />}
            {auditLogged ? "Logged to audit log" : "Log advisory memo"}
          </Button>
          <Button
            size="sm"
            onClick={handlePrint}
            className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-8 gap-1.5 shadow-sm"
          >
            <Printer className="h-3.5 w-3.5" /> Print Executive PDF
          </Button>
        </div>
      </div>

      {/* Printable Master Report Header (Visible in Print & Screen) */}
      <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Strategic Tax Alpha Engine
              </span>
              <span className="text-xs text-[var(--color-muted-foreground)]">·</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Prepared by Phyllis &amp; Truepost Tax Advisory
              </span>
            </div>
            <h1 className="text-2xl font-extrabold text-[var(--color-foreground)] tracking-tight">
              {clientName}
            </h1>
            <p className="text-xs text-[var(--color-muted-foreground)] max-w-2xl">
              {roadmap.executiveSummary}
            </p>
          </div>

          <div className="text-right sm:border-l sm:border-emerald-500/20 sm:pl-6">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Total Projected Annual Savings
            </span>
            <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              ${roadmap.totalEstimatedAnnualSavings.toLocaleString()}
            </div>
            <span className="text-[11px] text-[var(--color-muted-foreground)]">
              Based on ${roadmap.baselineNetProfit.toLocaleString()} Net Operating Profit
            </span>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-emerald-500/20">
          <div className="rounded-lg bg-white/60 dark:bg-black/20 p-2.5 border border-emerald-500/20">
            <div className="text-[11px] text-[var(--color-muted-foreground)]">Current Net Profit</div>
            <div className="text-base font-bold text-[var(--color-foreground)]">
              ${roadmap.baselineNetProfit.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg bg-white/60 dark:bg-black/20 p-2.5 border border-emerald-500/20">
            <div className="text-[11px] text-[var(--color-muted-foreground)]">Effective Bracket</div>
            <div className="text-base font-bold text-[var(--color-foreground)]">
              {roadmap.effectiveTaxBracketPercent}%
            </div>
          </div>
          <div className="rounded-lg bg-white/60 dark:bg-black/20 p-2.5 border border-emerald-500/20">
            <div className="text-[11px] text-[var(--color-muted-foreground)]">Active Strategies</div>
            <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
              4 Formulated
            </div>
          </div>
          <div className="rounded-lg bg-white/60 dark:bg-black/20 p-2.5 border border-emerald-500/20">
            <div className="text-[11px] text-[var(--color-muted-foreground)]">Status</div>
            <div className="text-base font-bold text-[var(--color-foreground)]">
              Draft for review
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Scenario Modeling Controls (Hidden in Print) */}
      <Card className="print:hidden border-indigo-500/20 bg-indigo-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-900 dark:text-indigo-300">
            <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Live Client Advisory Modeling Console
          </CardTitle>
          <CardDescription className="text-xs">
            Adjust tax brackets, owner parameters, and asset purchases to model strategic savings in real time with the client.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
                Owner Marginal Tax Bracket
              </label>
              <select
                value={marginalBracket}
                onChange={(e) => setMarginalBracket(Number(e.target.value))}
                className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
              >
                <option value={0.22}>22% Federal (Single $47k–$100k / MFJ $94k–$201k)</option>
                <option value={0.24}>24% Federal (Single $100k–$191k / MFJ $201k–$383k)</option>
                <option value={0.28}>28% Blended Federal + State (Recommended)</option>
                <option value={0.32}>32% Federal (Single $191k–$243k / MFJ $383k–$487k)</option>
                <option value={0.35}>35% Federal (Single $243k–$609k / MFJ $487k–$731k)</option>
                <option value={0.37}>37% Top Bracket (Income &gt; $609k+)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
                Owner Age (Retirement / Catch-up)
              </label>
              <input
                type="number"
                min={18}
                max={90}
                value={ownerAge}
                onChange={(e) => setOwnerAge(Number(e.target.value))}
                className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
                Executive Hours / Week (Default 40)
              </label>
              <input
                type="number"
                min={10}
                max={80}
                value={hoursPerWeek}
                onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
                Augusta Meeting Days (Max 14)
              </label>
              <input
                type="number"
                min={1}
                max={14}
                value={augustaDays}
                onChange={(e) => setAugustaDays(Math.min(14, Number(e.target.value)))}
                className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
                Augusta Daily Market Rate ($)
              </label>
              <input
                type="number"
                step={50}
                value={augustaDailyRate}
                onChange={(e) => setAugustaDailyRate(Number(e.target.value))}
                className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
                Planned Capital Equipment ($)
              </label>
              <input
                type="number"
                step={1000}
                value={plannedEquipment}
                onChange={(e) => setPlannedEquipment(Number(e.target.value))}
                placeholder="$0"
                className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
                Heavy Vehicle Purchases (&gt;6,000 lbs)
              </label>
              <input
                type="number"
                step={1000}
                value={heavyVehicles}
                onChange={(e) => setHeavyVehicles(Number(e.target.value))}
                placeholder="$0"
                className="w-full text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2"
              />
            </div>

            <div className="sm:col-span-2 flex items-end">
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                💡 Calculations update dynamically. Changes automatically propagate across all 4 strategy cards, cash flow forecasts, and printable executive workpapers.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* The 4 Core Advisory Strategy Pillar Cards */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Four Pillars of Strategic Tax Optimization
        </h3>

        {/* PILLAR 1: S-Corp Reasonable Compensation Optimizer */}
        <Card className={`border transition-all ${scorpOpt.isApplicable ? "border-emerald-500/30" : "border-[var(--color-border)] opacity-85"}`}>
          <CardHeader className="cursor-pointer" onClick={() => setExpandedStrategy(expandedStrategy === "scorp_recomp" ? null : "scorp_recomp")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                  <Landmark className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold">
                      1. S-Corporation Reasonable Compensation Optimizer (RC-Opt)
                    </CardTitle>
                    <Badge className={scorpOpt.isApplicable ? "bg-emerald-600 text-white text-[10px]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)] text-[10px]"}>
                      {scorpOpt.isApplicable ? "High Impact" : "Marginal Threshold"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Statutory Authority: {scorpOpt.ircAuthority}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Net Annual Savings</div>
                  <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                    ${scorpOpt.netAnnualSavings.toLocaleString()}
                  </div>
                </div>
                {expandedStrategy === "scorp_recomp" ? <ChevronUp className="h-5 w-5 text-[var(--color-muted-foreground)]" /> : <ChevronDown className="h-5 w-5 text-[var(--color-muted-foreground)]" />}
              </div>
            </div>
          </CardHeader>

          {expandedStrategy === "scorp_recomp" && (
            <CardContent className="pt-0 space-y-4 border-t border-[var(--color-border)] mt-2">
              <p className="text-xs text-[var(--color-foreground)] leading-relaxed mt-3">
                {scorpOpt.rationale}
              </p>

              {/* Side by side comparison table */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1 text-xs">
                  <div className="font-semibold text-rose-700 dark:text-rose-400">Current Unincorporated Structure</div>
                  <div className="flex justify-between py-1 border-b border-rose-500/10">
                    <span>Taxable Net Profit:</span>
                    <span className="font-medium">${scorpOpt.netProfit.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-rose-500/10">
                    <span>Self-Employment Tax Base (92.35%):</span>
                    <span className="font-medium">${Math.round(scorpOpt.netProfit * 0.9235).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 font-bold text-rose-700 dark:text-rose-400">
                    <span>Total Self-Employment Tax:</span>
                    <span>${scorpOpt.solePropSeTax.toLocaleString()}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1 text-xs">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">Optimized S-Corporation Structure</div>
                  <div className="flex justify-between py-1 border-b border-emerald-500/10">
                    <span>Reasonable Officer W-2 Salary:</span>
                    <span className="font-medium">${scorpOpt.recommendedSalary.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-emerald-500/10">
                    <span>Shareholder Distribution (Tax-Free of FICA):</span>
                    <span className="font-medium">${scorpOpt.recommendedDistribution.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-emerald-500/10">
                    <span>S-Corp Payroll Tax (FICA only on W-2):</span>
                    <span className="font-medium">${scorpOpt.sCorpPayrollTax.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-emerald-500/10 text-[var(--color-muted-foreground)]">
                    <span>Annual Payroll &amp; 1120-S Compliance:</span>
                    <span>-${scorpOpt.estimatedAdminComplianceCost.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 font-bold text-emerald-700 dark:text-emerald-400">
                    <span>Net Annual Cash Savings:</span>
                    <span>${scorpOpt.netAnnualSavings.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Implementation Roadmap */}
              <div className="rounded-md bg-[var(--color-muted)]/50 p-3 space-y-2">
                <div className="text-xs font-semibold flex items-center gap-1.5 text-[var(--color-foreground)]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Implementation Action Steps
                </div>
                <ul className="space-y-1 text-xs text-[var(--color-muted-foreground)]">
                  {scorpOpt.implementationRoadmap.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-bold text-emerald-600">•</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          )}
        </Card>

        {/* PILLAR 2: Augusta Rule (IRC § 280A(g)) Home Rental Strategy */}
        <Card className={`border transition-all ${augustaRule.isApplicable ? "border-emerald-500/30" : "border-[var(--color-border)]"}`}>
          <CardHeader className="cursor-pointer" onClick={() => setExpandedStrategy(expandedStrategy === "augusta_rule" ? null : "augusta_rule")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                  <Home className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold">
                      2. Augusta Rule (IRC § 280A(g)) 14-Day Corporate Meeting Rental
                    </CardTitle>
                    <Badge className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[10px]">
                      100% Tax-Free Income
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Statutory Authority: {augustaRule.ircAuthority}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Tax-Free Income Extracted</div>
                  <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                    ${augustaRule.totalTaxFreeIncome.toLocaleString()}
                  </div>
                </div>
                {expandedStrategy === "augusta_rule" ? <ChevronUp className="h-5 w-5 text-[var(--color-muted-foreground)]" /> : <ChevronDown className="h-5 w-5 text-[var(--color-muted-foreground)]" />}
              </div>
            </div>
          </CardHeader>

          {expandedStrategy === "augusta_rule" && (
            <CardContent className="pt-0 space-y-4 border-t border-[var(--color-border)] mt-2">
              <p className="text-xs text-[var(--color-foreground)] leading-relaxed mt-3">
                {augustaRule.rationale}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-xs space-y-1">
                  <div className="text-[var(--color-muted-foreground)]">Authorized Meeting Days</div>
                  <div className="text-base font-bold text-[var(--color-foreground)]">
                    {augustaRule.daysRented} days / year
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">Statutory 14-day ceiling under § 280A(g)</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-xs space-y-1">
                  <div className="text-[var(--color-muted-foreground)]">Fair Market Daily Rate</div>
                  <div className="text-base font-bold text-[var(--color-foreground)]">
                    ${augustaRule.dailyRate.toLocaleString()} / day
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">Based on commercial venue comps</div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
                  <div className="text-emerald-700 dark:text-emerald-400 font-semibold">Immediate Cash Tax Saved</div>
                  <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    ${augustaRule.totalAnnualSavings.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">Corporate deduction at {Math.round(marginalBracket * 100)}% bracket</div>
                </div>
              </div>

              {/* Implementation Roadmap */}
              <div className="rounded-md bg-[var(--color-muted)]/50 p-3 space-y-2">
                <div className="text-xs font-semibold flex items-center gap-1.5 text-[var(--color-foreground)]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Substantiation &amp; Due Diligence Requirements
                </div>
                <ul className="space-y-1 text-xs text-[var(--color-muted-foreground)]">
                  {augustaRule.implementationRoadmap.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-bold text-emerald-600">•</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          )}
        </Card>

        {/* PILLAR 3: Solo 401(k) & Cash Balance Defined Benefit Retirement Maximizer */}
        <Card className={`border transition-all ${retirementShelter.isApplicable ? "border-emerald-500/30" : "border-[var(--color-border)]"}`}>
          <CardHeader className="cursor-pointer" onClick={() => setExpandedStrategy(expandedStrategy === "retirement_shelter" ? null : "retirement_shelter")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                  <PiggyBank className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold">
                      3. Solo 401(k) &amp; Cash Balance Defined Benefit Retirement Shelter
                    </CardTitle>
                    <Badge className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[10px]">
                      {retirementShelter.cashBalanceEligible ? "Cash Balance Paired" : "Solo 401(k)"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Statutory Authority: {retirementShelter.ircAuthority}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Max Pre-Tax Shelter</div>
                  <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                    ${retirementShelter.totalRetirementDeduction.toLocaleString()}
                  </div>
                </div>
                {expandedStrategy === "retirement_shelter" ? <ChevronUp className="h-5 w-5 text-[var(--color-muted-foreground)]" /> : <ChevronDown className="h-5 w-5 text-[var(--color-muted-foreground)]" />}
              </div>
            </div>
          </CardHeader>

          {expandedStrategy === "retirement_shelter" && (
            <CardContent className="pt-0 space-y-4 border-t border-[var(--color-border)] mt-2">
              <p className="text-xs text-[var(--color-foreground)] leading-relaxed mt-3">
                {retirementShelter.rationale}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-xs space-y-1">
                  <div className="text-[var(--color-muted-foreground)]">Employee Elective Deferral</div>
                  <div className="text-base font-bold text-[var(--color-foreground)]">
                    ${retirementShelter.employeeElectiveDeferral.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">
                    {retirementShelter.ownerAge >= 50 ? "Includes $7,500 catch-up (Age 50+)" : "Standard 2024 limit"}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-xs space-y-1">
                  <div className="text-[var(--color-muted-foreground)]">Employer Profit Sharing</div>
                  <div className="text-base font-bold text-[var(--color-foreground)]">
                    ${retirementShelter.employerProfitSharing.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">Up to 25% of W-2 officer salary</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-xs space-y-1">
                  <div className="text-[var(--color-muted-foreground)]">Cash Balance DB Plan</div>
                  <div className="text-base font-bold text-[var(--color-foreground)]">
                    ${retirementShelter.cashBalanceContribution.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">
                    {retirementShelter.cashBalanceEligible ? "Actuarial high-earner layer" : "Eligible when profit > $150k"}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
                  <div className="text-emerald-700 dark:text-emerald-400 font-semibold">Immediate Tax Reduction</div>
                  <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    ${retirementShelter.estimatedTaxSavings.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">Estimated cash savings</div>
                </div>
              </div>

              {/* Implementation Roadmap */}
              <div className="rounded-md bg-[var(--color-muted)]/50 p-3 space-y-2">
                <div className="text-xs font-semibold flex items-center gap-1.5 text-[var(--color-foreground)]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Plan Adoption &amp; Funding Deadlines
                </div>
                <ul className="space-y-1 text-xs text-[var(--color-muted-foreground)]">
                  {retirementShelter.implementationRoadmap.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-bold text-emerald-600">•</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          )}
        </Card>

        {/* PILLAR 4: Section 179 Accelerated Depreciation & Heavy Vehicle Write-Off */}
        <Card className={`border transition-all ${section179.isApplicable ? "border-emerald-500/30" : "border-[var(--color-border)]"}`}>
          <CardHeader className="cursor-pointer" onClick={() => setExpandedStrategy(expandedStrategy === "section_179" ? null : "section_179")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold">
                      4. Section 179 Accelerated Depreciation &amp; Heavy Vehicle Write-Off
                    </CardTitle>
                    <Badge className={section179.isApplicable ? "bg-emerald-600 text-white text-[10px]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)] text-[10px]"}>
                      {section179.isApplicable ? "Active Purchases" : "Available Capacity"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Statutory Authority: {section179.ircAuthority}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-[var(--color-muted-foreground)]">First-Year Tax Deduction</div>
                  <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                    ${section179.totalFirstYearDeduction.toLocaleString()}
                  </div>
                </div>
                {expandedStrategy === "section_179" ? <ChevronUp className="h-5 w-5 text-[var(--color-muted-foreground)]" /> : <ChevronDown className="h-5 w-5 text-[var(--color-muted-foreground)]" />}
              </div>
            </div>
          </CardHeader>

          {expandedStrategy === "section_179" && (
            <CardContent className="pt-0 space-y-4 border-t border-[var(--color-border)] mt-2">
              <p className="text-xs text-[var(--color-foreground)] leading-relaxed mt-3">
                {section179.rationale}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-xs space-y-1">
                  <div className="text-[var(--color-muted-foreground)]">Qualifying Asset Purchases</div>
                  <div className="text-base font-bold text-[var(--color-foreground)]">
                    ${section179.qualifyingAssetPurchases.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">Equipment + Vehicles &gt; 6,000 lbs</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-xs space-y-1">
                  <div className="text-[var(--color-muted-foreground)]">Section 179 First-Year Write-Off</div>
                  <div className="text-base font-bold text-[var(--color-foreground)]">
                    ${section179.section179Deduction.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">100% full expensing elected</div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
                  <div className="text-emerald-700 dark:text-emerald-400 font-semibold">Immediate Cash Advantage</div>
                  <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    ${section179.immediateCashAdvantage.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">Versus 5-year MACRS schedule</div>
                </div>
              </div>

              {/* Implementation Roadmap */}
              <div className="rounded-md bg-[var(--color-muted)]/50 p-3 space-y-2">
                <div className="text-xs font-semibold flex items-center gap-1.5 text-[var(--color-foreground)]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Asset Placed-In-Service Verification
                </div>
                <ul className="space-y-1 text-xs text-[var(--color-muted-foreground)]">
                  {section179.implementationRoadmap.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-bold text-emerald-600">•</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Strategic Implementation Checklist Across the Tax Year */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-emerald-600" />
            Client &amp; Practitioner Execution Timeline
          </CardTitle>
          <CardDescription className="text-xs">
            Chronological roadmap for Phyllis and management to substantiate deductions under examination.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {roadmap.actionChecklist.map((item, idx) => (
            <div key={idx} className="rounded-lg border border-[var(--color-border)] p-3 space-y-1 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[var(--color-foreground)] flex items-center gap-1.5">
                  <Badge className="border border-[var(--color-border)] bg-[var(--color-card)] text-[10px] uppercase font-semibold text-[var(--color-muted-foreground)]">
                    {item.phase === "immediate_30_days" ? "Next 30 Days" : item.phase === "mid_year" ? "Mid-Year" : "Year-End Filing"}
                  </Badge>
                  {item.title}
                </span>
                <Badge className="bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300 text-[10px]">
                  {item.statutoryRef}
                </Badge>
              </div>
              <p className="text-[var(--color-muted-foreground)] leading-relaxed pt-1">
                {item.description}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Scope and limitations */}
      <div className="rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/40 p-4 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
          <FileCheck2 className="h-4 w-4 text-stone-500" />
          Scope and limitations
        </div>
        <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
          {roadmap.circular230AdvisoryNotice}
        </p>
      </div>
    </div>
  );
}
