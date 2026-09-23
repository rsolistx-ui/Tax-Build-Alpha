import { useEffect, useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Scale,
  FileCheck2,
  RefreshCw,
  Copy,
  Check,
  BookOpen,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatters";

export interface DifRiskFinding {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  clientMetric: string;
  benchmarkMetric: string;
  scoreImpact: number;
  title: string;
  explanation: string;
  codeCitation: string;
  actionableRemediation: string;
}

export interface DifAuditReport {
  score: number;
  rating: "low_risk" | "moderate_risk" | "high_risk";
  grossRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPercent: number;
  findings: DifRiskFinding[];
  comminglingCount: number;
  missingReceiptCount: number;
  defenseMemoPreview: string;
}

interface DifResponse {
  report: DifAuditReport;
  clientName: string;
  legalName?: string | null;
  taxYear: number;
  industry?: string | null;
}

export function DifAuditScannerPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<DifResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggingMemo, setLoggingMemo] = useState(false);
  const [memoLogged, setMemoLogged] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [showMemoModal, setShowMemoModal] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<Date | null>(null);

  async function loadAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<DifResponse>(`/api/clients/${clientId}/dif-audit`);
      setData(res);
      setLastScannedAt(new Date());
    } catch (e: any) {
      setError(e?.message || "Failed to load pre-filing audit risk report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAudit();
  }, [clientId]);

  async function handleLogDefenseMemo() {
    if (!data?.report.defenseMemoPreview) return;
    setLoggingMemo(true);
    try {
      await api(`/api/clients/${clientId}/dif-audit/memo`, {
        method: "POST",
        body: JSON.stringify({ memoText: data.report.defenseMemoPreview }),
      });
      setMemoLogged(true);
      setTimeout(() => setMemoLogged(false), 4000);
    } catch (e: any) {
      alert("Failed to log memo: " + e.message);
    } finally {
      setLoggingMemo(false);
    }
  }

  function handleCopyMemo() {
    if (!data?.report.defenseMemoPreview) return;
    navigator.clipboard.writeText(data.report.defenseMemoPreview);
    setCopiedMemo(true);
    setTimeout(() => setCopiedMemo(false), 3000);
  }

  if (loading) {
    return (
      <Card className="border-[var(--color-border)]">
        <CardContent className="py-16 text-center text-xs text-[var(--color-muted-foreground)] space-y-2">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto text-emerald-500" />
          <p>Running the pre-filing risk review…</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-rose-500/20 bg-rose-500/5">
        <CardContent className="py-8 text-center text-xs space-y-3">
          <AlertTriangle className="h-6 w-6 text-rose-500 mx-auto" />
          <p className="text-rose-700 dark:text-rose-400">{error || "Unable to generate DIF report."}</p>
          <Button size="sm" variant="outline" onClick={loadAudit}>
            Retry Scan
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { report, clientName, taxYear, industry } = data;
  const isLowRisk = report.rating === "low_risk";
  const isModerateRisk = report.rating === "moderate_risk";

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--color-foreground)] flex items-center gap-2">
              <Scale className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              Pre-Filing Risk Review
            </h2>
            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
              Internal review
            </Badge>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            An internal, explainable variance review for {clientName} ({taxYear} Tax Year · {industry || "General Business"}){lastScannedAt ? ` · Evaluated ${formatDateTime(lastScannedAt)}` : ""}. It is not an IRS score, audit prediction, or filing determination.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadAudit} className="text-xs h-8 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Re-Scan Books
          </Button>
          <Button
            size="sm"
            onClick={() => setShowMemoModal(true)}
            className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-8 gap-1.5 shadow-sm"
          >
            <FileCheck2 className="h-3.5 w-3.5" /> View Defense Memo
          </Button>
        </div>
      </div>

      {/* Top Gauge & Financial Snapshot Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Score Card */}
        <Card className={`border shadow-sm ${
          isLowRisk
            ? "border-emerald-500/30 bg-emerald-500/5"
            : isModerateRisk
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-rose-500/30 bg-rose-500/5"
        }`}>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Internal review score
            </CardDescription>
            <div className="flex items-baseline gap-2 pt-1">
              <span className={`text-4xl font-extrabold tracking-tight ${
                isLowRisk ? "text-emerald-700 dark:text-emerald-400" : isModerateRisk ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400"
              }`}>
                {report.score}
              </span>
              <span className="text-xs text-[var(--color-muted-foreground)] font-mono">/ 100</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              {isLowRisk ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span className="text-emerald-700 dark:text-emerald-400">Lower variance observed</span>
                </>
              ) : isModerateRisk ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-amber-700 dark:text-amber-400">Moderate Variance Detected</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                  <span className="text-rose-700 dark:text-rose-400">Elevated variance requires review</span>
                </>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
              {isLowRisk
                ? "Deductions and category ratios conform closely to IRS Statistics of Income benchmarks."
                : isModerateRisk
                ? "Certain expense ratios deviate from median norms. Document substantiation in workpapers before filing."
                : "Significant statistical anomalies detected. High likelihood of automated IRS matching inquiry."}
            </p>
          </CardContent>
        </Card>

        {/* Financial Profile */}
        <Card className="border-[var(--color-border)] shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Reconciled Financial Base
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[var(--color-border)]">
              <span className="text-[var(--color-muted-foreground)]">Gross Receipts:</span>
              <span className="font-mono font-semibold">${report.grossRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--color-border)]">
              <span className="text-[var(--color-muted-foreground)]">Total Deductions:</span>
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                ${report.totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[var(--color-muted-foreground)]">Net Profit / Margin:</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                ${report.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({report.profitMarginPercent.toFixed(1)}%)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Audit Watchdog Flags */}
        <Card className="border-[var(--color-border)] shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Substantiation &amp; Integrity Flags
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-muted-foreground)] flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${report.comminglingCount > 0 ? "bg-rose-500" : "bg-emerald-500"}`} />
                Commingled Personal Items:
              </span>
              <Badge className={report.comminglingCount > 0 ? "bg-rose-500/10 text-rose-700" : "bg-emerald-500/10 text-emerald-700"}>
                {report.comminglingCount} Detected
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[var(--color-muted-foreground)] flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${report.missingReceiptCount > 0 ? "bg-amber-500" : "bg-emerald-500"}`} />
                Missing Receipts (&gt; $75):
              </span>
              <Badge className={report.missingReceiptCount > 0 ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700"}>
                {report.missingReceiptCount} Missing
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[var(--color-muted-foreground)] flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${report.findings.length > 0 ? "bg-amber-500" : "bg-emerald-500"}`} />
                Statistical Variance Points:
              </span>
              <Badge className="font-mono">{report.findings.length} Flagged</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Findings Breakdown Table */}
      <Card className="border-[var(--color-border)] shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-emerald-600" />
            Audit Technique Guide Variance Breakdown ({report.findings.length} Item{report.findings.length === 1 ? "" : "s"})
          </CardTitle>
          <CardDescription className="text-xs">
            Every category evaluated against IRS Statistics of Income (SOI) national small-business baselines.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.findings.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--color-muted-foreground)] space-y-2">
              <ShieldCheck className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="font-medium text-emerald-700 dark:text-emerald-400">Zero Statistical Discrepancies Found</p>
              <p className="max-w-md mx-auto text-[11px]">
                All classified deductions, meals ratios, vehicle expenses, and contractor costs conform to standard IRS statistical thresholds.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {report.findings.map((finding) => (
                <div
                  key={finding.id}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2 hover:border-[var(--color-foreground)]/20 transition-all"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-[var(--color-foreground)]">{finding.title}</span>
                        <Badge
                          className={`text-[10px] ${
                            finding.severity === "critical"
                              ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
                              : finding.severity === "high"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                              : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                          }`}
                        >
                          {finding.severity.toUpperCase()} PRIORITY
                        </Badge>
                        <span className="font-mono text-[10px] text-[var(--color-muted-foreground)] bg-[var(--color-muted)] px-1.5 py-0.5 rounded">
                          {finding.codeCitation}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">
                        {finding.explanation}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                        +{finding.scoreImpact} DIF Points
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-[var(--color-border)]">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-[var(--color-muted-foreground)]">Client Metric:</span>
                      <strong className="text-[var(--color-foreground)]">{finding.clientMetric}</strong>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-[var(--color-muted-foreground)]">IRS Benchmark:</span>
                      <span className="font-mono text-slate-600 dark:text-slate-400">{finding.benchmarkMetric}</span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                    <strong>Actionable Due Diligence:</strong> {finding.actionableRemediation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Defense Memo Modal / Full View */}
      {showMemoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-3xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--color-foreground)] flex items-center gap-2">
                  <Scale className="h-5 w-5 text-emerald-600" />
                  Pre-filing review notes (draft)
                </h3>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Draft generated from this file. The preparer must review and edit it. Not legal advice and not audit protection.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowMemoModal(false)} className="h-8 w-8 p-0">
                ✕
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-slate-950 p-4 font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
              {report.defenseMemoPreview}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyMemo} className="text-xs h-8 gap-1.5">
                  {copiedMemo ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedMemo ? "Copied to Clipboard!" : "Copy Memo Text"}
                </Button>
                {memoLogged && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    ✓ Logged permanently in firm audit vault!
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowMemoModal(false)} className="text-xs h-8">
                  Close
                </Button>
                <Button
                  size="sm"
                  disabled={loggingMemo || memoLogged}
                  onClick={handleLogDefenseMemo}
                  className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-8 gap-1.5 shadow-sm"
                >
                  <FileCheck2 className="h-3.5 w-3.5" />
                  {loggingMemo ? "Recording..." : "Log in Compliance Audit Vault"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
