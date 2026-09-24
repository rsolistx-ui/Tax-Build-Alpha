import { useState, useEffect } from "react";
import { Copy, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { TaxHandoffPanel } from "@/components/tax-handoff-panel";
import { Contractor1099Panel } from "@/components/contractor-1099-panel";

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

const tabClass = (active: boolean) =>
  `px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
    active
      ? "bg-[var(--color-primary)] text-white"
      : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
  }`;

export function TaxBridgePanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [activeSection, setActiveSection] = useState<"bridge" | "1099" | "scorp">("bridge");
  const [scorp, setScorp] = useState<SCorpAnalysis | null>(null);

  useEffect(() => {
    loadSCorpAnalysis();
  }, [clientId]);

  async function loadSCorpAnalysis() {
    try {
      const res = await api<{ analysis: SCorpAnalysis }>(`/api/clients/${clientId}/s-corp-analysis`);
      setScorp(res.analysis);
    } catch {}
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3">
        <button onClick={() => setActiveSection("bridge")} className={tabClass(activeSection === "bridge")}>
          Schedule C handoff
        </button>
        <button onClick={() => setActiveSection("1099")} className={tabClass(activeSection === "1099")}>
          1099 contractors
        </button>
        <button onClick={() => setActiveSection("scorp")} className={tabClass(activeSection === "scorp")}>
          S-Corp Advisory Calculator
          {scorp?.isRecommended ? (
            <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border-none">
              Save ${Math.round(scorp.netAnnualSavings / 1000)}k/yr
            </Badge>
          ) : null}
        </button>
      </div>

      {activeSection === "bridge" ? <TaxHandoffPanel clientId={clientId} taxYear={taxYear} /> : null}

      {activeSection === "1099" ? <Contractor1099Panel clientId={clientId} taxYear={taxYear} /> : null}

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
