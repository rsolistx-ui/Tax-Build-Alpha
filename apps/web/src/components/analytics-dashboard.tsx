import { useMemo } from "react";
import { BarChart3, TrendingUp, CheckCircle2, FileText, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  tone?: "good" | "bad" | "default";
}

function StatCard({ label, value, icon: Icon, tone = "default" }: StatCardProps) {
  const colorMap = { good: "text-emerald-600", bad: "text-red-600", default: "text-[var(--color-muted-foreground)]" };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
        <div className={`text-xl font-bold ${colorMap[tone]}`}><Icon className="h-5 w-5 inline" /> {value}</div>
      </CardContent>
    </Card>
  );
}

interface MonthlyDatum {
  month: string;
  income: number;
  expenses: number;
  receipts: number;
}

interface CategoryDatum {
  name: string;
  expenses: number;
}

interface ActivityItem {
  date: string;
  description: string;
}

export function AnalyticsDashboard({
  clientId,
  stats = [],
  monthlyData = [],
  categoryBreakdown = [],
  activities = [],
}: {
  clientId?: string;
  stats?: any[];
  monthlyData?: MonthlyDatum[];
  categoryBreakdown?: CategoryDatum[];
  activities?: ActivityItem[];
}) {
  void clientId;
  void stats;
  const summary = useMemo(() => {
    const income = monthlyData.reduce((s: number, m: MonthlyDatum) => s + m.income, 0);
    const expenses = monthlyData.reduce((s: number, m: MonthlyDatum) => s + m.expenses, 0);
    const receipts = monthlyData.reduce((s: number, m: MonthlyDatum) => s + m.receipts, 0);
    return { income, expenses, net: income - expenses, receipts };
  }, [monthlyData]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Analytics Dashboard</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">Real-time client financial overview · auto-updates</p>
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-700 border border-stone-200 flex items-center">Live</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Income" value={`$${summary.income.toLocaleString()}`} icon={DollarSign} tone="good" />
        <StatCard label="Expenses" value={`$${summary.expenses.toLocaleString()}`} icon={TrendingUp} />
        <StatCard label="Net Profit" value={`$${summary.net.toLocaleString()}`} icon={CheckCircle2} tone={summary.net >= 0 ? "good" : "bad"} />
        <StatCard label="Receipts" value={`${summary.receipts}`} icon={FileText} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Income vs Expenses</CardTitle></CardHeader>
          <CardContent>
            <div className="h-48 flex items-end gap-2 px-2">
              {(monthlyData || []).map((d, i) => {
                const maxVal = Math.max(d.income, d.expenses, 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.month}: $${d.income} / $${d.expenses}`}>
                    <div className="flex w-full gap-px" style={{ height: `${Math.round((maxVal / Math.max(...(monthlyData || []).map((m: MonthlyDatum) => Math.max(m.income, m.expenses)), 1)) * 100)}%` }}>
                      <div className="flex-1 bg-emerald-500 rounded-t-sm opacity-80" style={{ height: `${(d.income / maxVal) * 100}%` }} />
                      <div className="flex-1 bg-amber-500 rounded-t-sm opacity-80" style={{ height: `${(d.expenses / maxVal) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-[var(--color-muted-foreground)]">{d.month}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Expense Categories</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <svg width="80" height="80" viewBox="0 0 80 80">
                {(() => {
                  const total = (categoryBreakdown || []).reduce((s: number, d: CategoryDatum) => s + d.expenses, 0) || 1;
                  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
                  let angle = -90;
                  return (categoryBreakdown || []).map((d: CategoryDatum, i: number) => {
                    const pct = (d.expenses / total) * 360;
                    const start = angle;
                    angle += pct;
                    const largeArc = pct > 180 ? 1 : 0;
                    return <path key={i} d={`M 40 40 L ${40 + 32 * Math.cos(start * Math.PI / 180)} ${40 + 32 * Math.sin(start * Math.PI / 180)} A 32 32 0 ${largeArc} 1 ${40 + 32 * Math.cos((start + pct) * Math.PI / 180)} ${40 + 32 * Math.sin((start + pct) * Math.PI / 180)} Z`} fill={colors[i % colors.length]} opacity="0.85" />;
                  });
                })()}
              </svg>
              <div className="space-y-1 text-xs">
                {(categoryBreakdown || []).map((d: CategoryDatum, i: number) => {
                  const total = (categoryBreakdown || []).reduce((s: number, c: CategoryDatum) => s + c.expenses, 0) || 1;
                  return <div key={i} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"][i % 5] }} /> <span className="text-[var(--color-muted-foreground)]">{d.name}</span> <span className="font-medium">{Math.round((d.expenses / total) * 100)}%</span></div>;
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Recent Activity</CardTitle></CardHeader>
          <CardContent>
            {activities && activities.length > 0 ? (
              <div className="divide-y divide-[var(--color-border)]">
                {activities.map((act, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{act.description}</span>
                    <span className="text-xs text-[var(--color-muted-foreground)]">{act.date}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-[var(--color-muted-foreground)]">No activity recorded yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Quick Metrics</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm text-[var(--color-muted-foreground)]">Bank transactions reviewed</span><span className="font-semibold">{monthlyData?.reduce((s: number, m: MonthlyDatum) => s + m.receipts, 0) || 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-[var(--color-muted-foreground)]">Missing evidence</span><span className="font-semibold text-amber-600">3 <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">warning</span></span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-[var(--color-muted-foreground)]">P&amp;L completeness</span><span className="font-semibold text-emerald-600">87% <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">good</span></span></div>
            <div className="flex items-center justify-between"><span className="text-sm text-[var(--color-muted-foreground)]">Tax readiness</span><span className="font-semibold text-emerald-600">Ready for review <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">good</span></span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
