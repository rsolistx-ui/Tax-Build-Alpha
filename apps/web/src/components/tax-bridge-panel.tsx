import { useState, useEffect } from "react";
import {
  Copy,
  Check,
  Printer,
  Sparkles,
  AlertTriangle,
  UserCheck,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface ContractorItem {
  contractorName: string;
  totalPaid: number;
  hasW9: boolean;
  einSsnLast4: string | null;
  needs1099: boolean;
  status: "ready_to_file" | "missing_w9" | "under_threshold";
  suggestedAction: string;
}

interface SCorpAnalysis {
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

export function TaxBridgePanel({ clientId }: { clientId: string }) {
  const [activeSection, setActiveSection] = useState<"bridge" | "1099" | "scorp">("bridge");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  // P&L & Schedule C Data
  const [pnlData, setPnlData] = useState<any>(null);

  // 1099 Radar Data
  const [contractors, setContractors] = useState<ContractorItem[]>([]);
  const [loadingContractors, setLoadingContractors] = useState(false);

  // S-Corp Analysis Data
  const [scorp, setScorp] = useState<SCorpAnalysis | null>(null);

  useEffect(() => {
    loadPnl();
    load1099Radar();
    loadSCorpAnalysis();
  }, [clientId]);

  async function loadPnl() {
    setLoading(true);
    try {
      const d = await api<any>(`/api/clients/${clientId}/pnl`);
      setPnlData(d);
    } catch {}
    finally {
      setLoading(false);
    }
  }

  async function load1099Radar() {
    setLoadingContractors(true);
    try {
      const res = await api<{ contractors: ContractorItem[] }>(`/api/clients/${clientId}/1099-radar`);
      setContractors(res.contractors || []);
    } catch {}
    finally {
      setLoadingContractors(false);
    }
  }

  async function loadSCorpAnalysis() {
    try {
      const res = await api<{ analysis: SCorpAnalysis }>(`/api/clients/${clientId}/s-corp-analysis`);
      setScorp(res.analysis);
    } catch {}
  }

  async function markW9Received(contractorName: string) {
    try {
      await api(`/api/clients/${clientId}/1099-radar/w9`, {
        method: "POST",
        body: JSON.stringify({ contractorName, hasW9: true }),
      });
      await load1099Radar();
    } catch {}
  }

  // Calculate Schedule C lines from live PnL
  const grossIncome = Number(pnlData?.income?.total ?? 0);
  const totalExpenses = Number(pnlData?.expenses?.total ?? 0);
  const netProfit = Number(pnlData?.net ?? grossIncome - totalExpenses);

  const categories: Array<{ name: string; amount: number }> =
    pnlData?.expenses?.categories || pnlData?.categories?.filter((c: any) => !c.isIncome) || [];

  function getCatAmount(keywords: string[]): number {
    return categories
      .filter((c) => keywords.some((k) => c.name.toLowerCase().includes(k)))
      .reduce((sum, c) => sum + Math.abs(Number(c.amount || 0)), 0);
  }

  const lineAdvertising = getCatAmount(["advertising", "marketing", "promotion"]);
  const lineVehicle = getCatAmount(["car", "truck", "gas", "fuel", "auto"]);
  const lineContractLabor = getCatAmount(["contract", "labor", "freelance", "subcontractor"]);
  const lineLegalProf = getCatAmount(["legal", "professional", "accounting", "cpa", "attorney"]);
  const lineOffice = getCatAmount(["office", "software", "saas", "postage", "shipping"]);
  const lineSupplies = getCatAmount(["supplies", "materials"]);
  const lineTaxes = getCatAmount(["tax", "license", "permit"]);
  const lineMealsRaw = getCatAmount(["meal", "dining", "restaurant", "food"]);
  const lineMeals50 = Math.round(lineMealsRaw * 0.5 * 100) / 100;
  const lineUtilities = getCatAmount(["utilit", "phone", "internet", "electric"]);

  // Calculate other expenses as remainder
  const sumMajorLines =
    lineAdvertising +
    lineVehicle +
    lineContractLabor +
    lineLegalProf +
    lineOffice +
    lineSupplies +
    lineTaxes +
    lineMeals50 +
    lineUtilities;
  const lineOther = Math.max(0, totalExpenses - sumMajorLines);

  const scheduleCLines = [
    { line: "Part I, Line 1", label: "Gross Receipts or Sales", amount: grossIncome },
    { line: "Part I, Line 7", label: "Gross Income", amount: grossIncome },
    { line: "Part II, Line 8", label: "Advertising", amount: lineAdvertising },
    { line: "Part II, Line 9", label: "Car and Truck Expenses", amount: lineVehicle },
    { line: "Part II, Line 11", label: "Contract Labor", amount: lineContractLabor },
    { line: "Part II, Line 17", label: "Legal and Professional Services", amount: lineLegalProf },
    { line: "Part II, Line 18", label: "Office Expense", amount: lineOffice },
    { line: "Part II, Line 22", label: "Supplies", amount: lineSupplies },
    { line: "Part II, Line 23", label: "Taxes and Licenses", amount: lineTaxes },
    { line: "Part II, Line 24b", label: "Deductible Meals (50% rule applied)", amount: lineMeals50 },
    { line: "Part II, Line 25", label: "Utilities", amount: lineUtilities },
    { line: "Part II, Line 27a", label: "Other Expenses", amount: lineOther },
    { line: "Part II, Line 28", label: "Total Expenses", amount: totalExpenses },
    { line: "Part II, Line 31", label: "Net Profit or (Loss)", amount: netProfit },
  ];

  function copyScheduleCToClipboard() {
    const text = scheduleCLines
      .map((l) => `${l.line}\t${l.label}\t$${l.amount.toFixed(2)}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSection("bridge")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              activeSection === "bridge"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            Schedule C Tax Prep Bridge
          </button>
          <button
            onClick={() => setActiveSection("1099")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeSection === "1099"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            1099 Radar ({contractors.filter((c) => c.needs1099).length})
            {contractors.some((c) => c.status === "missing_w9") ? (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            ) : null}
          </button>
          <button
            onClick={() => setActiveSection("scorp")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeSection === "scorp"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            S-Corp Advisory Calculator
            {scorp?.isRecommended ? (
              <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border-none">
                Save ${Math.round(scorp.netAnnualSavings / 1000)}k/yr
              </Badge>
            ) : null}
          </button>
        </div>

        {activeSection === "bridge" ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 gap-1.5"
              onClick={copyScheduleCToClipboard}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied All Lines!" : "Copy for MyTAXPrepOffice"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 gap-1.5"
              onClick={() => window.print()}
            >
              <Printer className="h-3.5 w-3.5" />
              Print Summary
            </Button>
          </div>
        ) : null}
      </div>

      {/* SECTION 1: SCHEDULE C TAX PREP BRIDGE */}
      {activeSection === "bridge" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-emerald-900 dark:text-emerald-100">
                60-Second Tax Software Bridge:
              </span>{" "}
              <span className="text-emerald-800/80 dark:text-emerald-200/80">
                Open MyTAXPrepOffice, ProConnect, or Drake on one screen and Truepost on the other. Every number below is
                verified against your bank feeds and receipt evidence, mapped line-for-line to Form 1040 Schedule C.
              </span>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>IRS Form 1040 Schedule C Alignment</span>
                <span className="text-xs font-mono text-[var(--color-muted-foreground)]">
                  Net: ${netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </CardTitle>
              <CardDescription>
                Click any line to copy its exact dollar value to your clipboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-xs text-[var(--color-muted-foreground)] py-6 text-center">
                  Calculating verified Schedule C lines...
                </p>
              ) : (
                <div className="divide-y divide-[var(--color-border)] text-xs font-mono">
                  {scheduleCLines.map((row, i) => {
                    const isTotalLine =
                      row.line.includes("Line 7") || row.line.includes("Line 28") || row.line.includes("Line 31");
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          navigator.clipboard.writeText(row.amount.toFixed(2));
                        }}
                        className={`py-2.5 px-2 flex items-center justify-between cursor-pointer transition-colors hover:bg-[var(--color-muted)] ${
                          isTotalLine ? "font-bold bg-[var(--color-muted)]/30 text-sm" : ""
                        }`}
                        title="Click to copy amount"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-28 text-[var(--color-muted-foreground)] font-sans">{row.line}</span>
                          <span className="font-sans text-[var(--color-foreground)]">{row.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={row.amount < 0 ? "text-red-600" : ""}>
                            ${row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* SECTION 2: 1099 RADAR */}
      {activeSection === "1099" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-amber-900 dark:text-amber-100">
                Automated 1099-NEC Threshold Tracking:
              </span>{" "}
              <span className="text-amber-800/80 dark:text-amber-200/80">
                Contractors paid $600 or more in the tax year require Form 1099-NEC. Missing W-9s are highlighted so
                you can request them before the January 31 deadline.
              </span>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Contractors & Vendor Payments</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {contractors.filter((c) => c.needs1099).length} Exceeding $600
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingContractors ? (
                <p className="text-xs text-[var(--color-muted-foreground)] py-6 text-center">
                  Scanning vendor transactions...
                </p>
              ) : contractors.length === 0 ? (
                <div className="text-center py-8 border border-dashed rounded-lg">
                  <UserCheck className="h-8 w-8 mx-auto text-[var(--color-muted-foreground)] opacity-40 mb-2" />
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    No contractor payments over $100 found yet in bank transactions or receipts.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {contractors.map((c, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-3 ${
                        c.status === "missing_w9"
                          ? "border-amber-300 bg-amber-500/5"
                          : "border-[var(--color-border)] bg-[var(--color-card)]"
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{c.contractorName}</span>
                          {c.status === "ready_to_file" ? (
                            <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">
                              1099 Ready (W-9 on file)
                            </Badge>
                          ) : c.status === "missing_w9" ? (
                            <Badge className="bg-amber-100 text-amber-800 text-[10px]">
                              Missing W-9 (Exceeds $600)
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-700 text-[10px]">
                              Under $600 Threshold
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">{c.suggestedAction}</p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-mono font-bold text-sm">
                            ${c.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </div>
                          <span className="text-[10px] text-[var(--color-muted-foreground)]">YTD Total</span>
                        </div>

                        {c.status === "missing_w9" ? (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7 text-[var(--color-primary)]"
                              onClick={() => markW9Received(c.contractorName)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Mark W-9 Received
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* SECTION 3: S-CORP ADVISORY OPTIMIZER */}
      {activeSection === "scorp" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-purple-900 dark:text-purple-100">
                High-Value Entity Structuring Advisory:
              </span>{" "}
              <span className="text-purple-800/80 dark:text-purple-200/80">
                When a sole proprietorship makes over $60k in net profit, electing S-Corporation status (Form 2553)
                allows taking shareholder distributions exempt from the 15.3% Self-Employment tax.
              </span>
            </div>
          </div>

          {scorp ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-[var(--color-muted-foreground)]">Sole Prop SE Tax (15.3%)</div>
                    <div className="text-2xl font-bold text-red-600 mt-1">
                      ${scorp.solePropSeTax.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-[var(--color-muted-foreground)] mt-1">
                      Paid on 92.35% of all net profit
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-[var(--color-muted-foreground)]">S-Corp Officer FICA Tax</div>
                    <div className="text-2xl font-bold text-amber-600 mt-1">
                      ${scorp.sCorpPayrollTax.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-[var(--color-muted-foreground)] mt-1">
                      Paid only on $${scorp.sCorpReasonableSalary.toLocaleString()} salary
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-emerald-500/30 bg-emerald-500/5">
                  <CardContent className="p-4">
                    <div className="text-xs text-emerald-700 font-semibold">Net Annual Client Tax Savings</div>
                    <div className="text-3xl font-extrabold text-emerald-600 mt-1">
                      ${scorp.netAnnualSavings.toLocaleString()} / yr
                    </div>
                    <div className="text-[10px] text-emerald-700/80 mt-1">
                      After $1,500 payroll & Form 1120-S costs
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Advisory Recommendation for Client</span>
                    <Badge
                      className={
                        scorp.isRecommended
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-700"
                      }
                    >
                      {scorp.isRecommended ? "S-Corp Election Highly Recommended" : "Sole Prop Currently Optimal"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs leading-relaxed">
                  <p className="p-3.5 rounded-lg bg-[var(--color-muted)] font-mono">
                    {scorp.advisorySummary}
                  </p>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(scorp.advisorySummary);
                        alert("Advisory proposal text copied to clipboard!");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy Advisory Proposal Text
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
