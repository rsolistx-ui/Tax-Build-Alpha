import { useState, useEffect } from "react";
import { Receipt, Banknote, Clock, TrendingUp, Download, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TimeSavingsData = {
  weeklyData: Array<{ week: string; hoursSaved: number; target: number }>;
  totalHoursSaved: number;
  hoursFromReceipts: number;
  hoursFromBank: number;
  hoursFromChasing: number;
  hoursFromEsign: number;
  measuredEvents: number;
  estimateMethod: string;
  weeksToTarget: number | null;
  progressPercent: number;
};

export function TimeSavingsTracker() {
  const [data, setData] = useState<TimeSavingsData | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    try {
      const result = await api<TimeSavingsData>("/api/time-savings");
      setData(result);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function exportReport(format: "pdf" | "csv") {
    if (!data) return;
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => {
      params.set(key, JSON.stringify(value));
    });
    window.open(`/api/time-savings/export?format=${format}&${params.toString()}`, "_blank");
  }

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-muted)]" />
          <div className="mt-6 grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded bg-[var(--color-muted)]" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || typeof data.totalHoursSaved !== "number") return null;

  const totalHoursSaved = Number(data.totalHoursSaved || 0);
  const hoursFromReceipts = Number(data.hoursFromReceipts || 0);
  const hoursFromBank = Number(data.hoursFromBank || 0);
  const hoursFromChasing = Number(data.hoursFromChasing || 0);
  const hoursFromEsign = Number(data.hoursFromEsign || 0);
  const progressRefills = Math.min(100, (totalHoursSaved / 10) * 100);
  const weeklyData = Array.isArray(data.weeklyData) ? data.weeklyData : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4" />
          Time Savings Tracker
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => exportReport("csv")}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={() => exportReport("pdf")}>
            <Download className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-muted-foreground)]">Measured weekly estimate</span>
              <span className="font-medium">{totalHoursSaved.toFixed(1)} / 10 hours</span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-[var(--color-muted)]">
              <div
                className="h-2 rounded-full bg-[var(--color-primary)]"
                style={{ width: `${progressRefills}%` }}
              />
            </div>
            {data.measuredEvents === 0 ? (
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">No completed workflow events have been recorded this week. This figure will populate from real work—not a preset claim.</p>
            ) : data.weeksToTarget !== null && data.weeksToTarget !== undefined && (
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                {data.weeksToTarget > 0
                  ? `${data.weeksToTarget} more weeks to reach 10+ hour target`
                  : "Target reached! Keep it up."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-lg bg-[var(--color-muted)]/50 p-4">
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                <Receipt className="h-3 w-3" />
                Receipt Processing
              </div>
              <div className="mt-1 text-2xl font-semibold">{hoursFromReceipts.toFixed(1)}h</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                {totalHoursSaved > 0 ? ((hoursFromReceipts / totalHoursSaved) * 100).toFixed(0) : "0"}% of savings
              </div>
            </div>
            <div className="rounded-lg bg-[var(--color-muted)]/50 p-4">
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]"><CheckCircle2 className="h-3 w-3" /> Secure signing</div>
              <div className="mt-1 text-2xl font-semibold">{hoursFromEsign.toFixed(1)}h</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">Completed documents only</div>
            </div>

            <div className="rounded-lg bg-[var(--color-muted)]/50 p-4">
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                <Banknote className="h-3 w-3" />
                Bank Statements
              </div>
              <div className="mt-1 text-2xl font-semibold">{hoursFromBank.toFixed(1)}h</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                {totalHoursSaved > 0 ? ((hoursFromBank / totalHoursSaved) * 100).toFixed(0) : "0"}% of savings
              </div>
            </div>

            <div className="rounded-lg bg-[var(--color-muted)]/50 p-4">
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                <Clock className="h-3 w-3" />
                Client Chasing
              </div>
              <div className="mt-1 text-2xl font-semibold">{hoursFromChasing.toFixed(1)}h</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                {totalHoursSaved > 0 ? ((hoursFromChasing / totalHoursSaved) * 100).toFixed(0) : "0"}% of savings
              </div>
            </div>
          </div>

          {weeklyData.length > 0 && (
            <div>
              <h4 className="mb-3 text-sm font-medium">Weekly Breakdown</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="px-4 py-2 text-left">Week</th>
                      <th className="px-4 py-2 text-right">Hours Saved</th>
                      <th className="px-4 py-2 text-right">Target</th>
                      <th className="px-4 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyData.map((week, i) => (
                      <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="px-4 py-2">{week.week}</td>
                        <td className="px-4 py-2 text-right font-medium">{Number(week.hoursSaved || 0).toFixed(1)}h</td>
                        <td className="px-4 py-2 text-right text-[var(--color-muted-foreground)]">{Number(week.target || 0).toFixed(1)}h</td>
                        <td className="px-4 py-2 text-right">
                          <Badge
                            className={
                              week.hoursSaved >= week.target
                                ? "bg-emerald-500 text-white"
                                : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                            }
                          >
                            {week.hoursSaved >= week.target ? "On target" : "Under target"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="text-xs text-[var(--color-muted-foreground)]">{data.estimateMethod}</p>
        </div>
      </CardContent>
    </Card>
  );
}
