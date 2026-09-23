import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  Loader2,
  Mail,
  Radar,
  Send,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ContractorItem {
  vendorName: string;
  totalPaid: number;
  paymentCount: number;
  lastPaymentDate: string | null;
  requires1099: boolean;
  status: "exceeded_threshold" | "approaching_threshold" | "below_threshold";
  w9Status: "on_file" | "requested" | "missing";
}

interface RadarData {
  taxYear: number;
  statutoryThreshold: number;
  summary: {
    totalVendorsEvaluated: number;
    requiring1099: number;
    missingW9: number;
    total1099Spend: number;
  };
  contractors: ContractorItem[];
}

export function Contractor1099Panel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<RadarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatchingVendor, setDispatchingVendor] = useState<string | null>(null);
  const [dispatchEmail, setDispatchEmail] = useState("");
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);

  useEffect(() => {
    void loadRadar();
  }, [clientId]);

  async function loadRadar() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<RadarData>(`/api/clients/${clientId}/1099-radar`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || "Failed to load 1099 contractor radar");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendW9(vendorName: string) {
    if (!dispatchEmail || !dispatchEmail.includes("@")) {
      setError("Please provide a valid contractor email address.");
      return;
    }

    try {
      const res = await api<{ message: string }>(`/api/clients/${clientId}/1099-radar/request-w9`, {
        method: "POST",
        body: JSON.stringify({
          contractorName: vendorName,
          email: dispatchEmail.trim(),
        }),
      });

      setDispatchSuccess(res.message);
      setDispatchingVendor(null);
      setDispatchEmail("");
      void loadRadar();
    } catch (e: any) {
      setError(e?.message || "Failed to dispatch W-9 request");
    }
  }

  if (loading) {
    return (
      <Card className="border border-[var(--color-border)]">
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
        </CardContent>
      </Card>
    );
  }

  const summary = data?.summary || { totalVendorsEvaluated: 0, requiring1099: 0, missingW9: 0, total1099Spend: 0 };
  const contractors = data?.contractors || [];

  return (
    <Card className="border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
              <Radar className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-semibold">1099 Contractor Threshold Radar</CardTitle>
              <CardDescription className="text-xs">
                Real-time tracking of payee spend against the $600 IRS statutory threshold for Form 1099-NEC.
              </CardDescription>
            </div>
          </div>
          <Badge className="border border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-foreground)] text-xs">
            Tax Year {data?.taxYear || new Date().getFullYear()} · Threshold: $600.00
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-center gap-2 rounded-md bg-rose-50 p-2.5 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {dispatchSuccess ? (
          <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{dispatchSuccess}</span>
          </div>
        ) : null}

        {/* Radar Metric Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
            <p className="text-[11px] font-medium text-[var(--color-muted-foreground)]">1099-NEC Mandated</p>
            <p className="mt-1 text-lg font-bold text-rose-600 dark:text-rose-400">{summary.requiring1099}</p>
            <p className="text-[10px] text-[var(--color-muted-foreground)]">Paid ≥ $600 statutory cap</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
            <p className="text-[11px] font-medium text-[var(--color-muted-foreground)]">Missing W-9 on File</p>
            <p className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">{summary.missingW9}</p>
            <p className="text-[10px] text-[var(--color-muted-foreground)]">Statutory audit risk</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
            <p className="text-[11px] font-medium text-[var(--color-muted-foreground)]">1099 Contractor Spend</p>
            <p className="mt-1 text-lg font-bold text-[var(--color-foreground)]">
              ${summary.total1099Spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-[var(--color-muted-foreground)]">Total qualified outflows</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
            <p className="text-[11px] font-medium text-[var(--color-muted-foreground)]">Vendors Screened</p>
            <p className="mt-1 text-lg font-bold text-[var(--color-foreground)]">{summary.totalVendorsEvaluated}</p>
            <p className="text-[10px] text-[var(--color-muted-foreground)]">Cross-referenced bank feed</p>
          </div>
        </div>

        {/* Dispatch Modal Box (Inline) */}
        {dispatchingVendor ? (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                Dispatch IRS Form W-9 Request to {dispatchingVendor}
              </span>
              <button
                type="button"
                onClick={() => setDispatchingVendor(null)}
                className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-indigo-800 dark:text-indigo-300">
              Creates a Form W-9 signature request in this client's E-sign tab. Nothing is sent to the contractor automatically.
            </p>
            <div className="flex gap-2 pt-1">
              <input
                type="email"
                placeholder="contractor@email.com"
                value={dispatchEmail}
                onChange={(e) => setDispatchEmail(e.target.value)}
                className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1.5 text-xs text-[var(--color-foreground)]"
              />
              <Button size="sm" onClick={() => void handleSendW9(dispatchingVendor)} className="gap-1 bg-indigo-600 hover:bg-indigo-700 text-white">
                <Send className="h-3.5 w-3.5" /> Dispatch
              </Button>
            </div>
          </div>
        ) : null}

        {/* Contractor List */}
        {contractors.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--color-muted-foreground)]">
            No bank payments over $250 recorded yet for this client. Import transactions to populate radar.
          </p>
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] overflow-hidden">
            {contractors.map((c, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-2 bg-[var(--color-card)] hover:bg-[var(--color-muted)]/30 transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--color-foreground)]">{c.vendorName}</span>
                    {c.requires1099 ? (
                      <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 text-[10px]">
                        1099-NEC Required
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px]">
                        Approaching Cap
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                    Paid: ${c.totalPaid.toFixed(2)} across {c.paymentCount} payment{c.paymentCount === 1 ? "" : "s"}
                    {c.lastPaymentDate ? ` · Last active ${c.lastPaymentDate}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {c.w9Status === "on_file" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <FileCheck className="h-3.5 w-3.5" /> W-9 On File
                    </span>
                  ) : c.w9Status === "requested" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
                      <Mail className="h-3.5 w-3.5" /> W-9 Pending Signature
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 font-medium">
                        <ShieldAlert className="h-3.5 w-3.5" /> Missing W-9
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDispatchingVendor(c.vendorName);
                          setDispatchEmail("");
                        }}
                        className="h-7 text-xs gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400"
                      >
                        <Send className="h-3 w-3" /> Request W-9
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
