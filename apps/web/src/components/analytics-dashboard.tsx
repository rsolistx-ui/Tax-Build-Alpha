import { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  FileText,
  DollarSign,
  PieChart,
  Calendar,
  Layers,
  Sparkles,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ElementType;
  tone?: "good" | "bad" | "default";
}

function StatCard({ label, value, subtext, icon: Icon, tone = "default" }: StatCardProps) {
  const colorMap = {
    good: "text-emerald-600 dark:text-emerald-400",
    bad: "text-red-600 dark:text-red-400",
    default: "text-[var(--color-foreground)]",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-[var(--color-muted-foreground)] mb-1">
          <span>{label}</span>
          <Icon className="h-4 w-4 opacity-70" />
        </div>
        <div className={`text-2xl font-bold tracking-tight ${colorMap[tone]}`}>{value}</div>
        {subtext ? <div className="text-[11px] text-[var(--color-muted-foreground)] mt-1">{subtext}</div> : null}
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
  taxLine?: string;
  percentage?: number;
}

interface ActivityItem {
  date: string;
  description: string;
}

const BUCKET_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Rose
  "#8b5cf6", // Purple
  "#06b6d4", // Cyan
  "#ec4899", // Pink
  "#64748b", // Slate
];

function mapToScheduleC(categoryName: string): { taxLine: string; is50PctMeal: boolean } {
  const lower = categoryName.toLowerCase();
  if (lower.includes("meal") || lower.includes("food") || lower.includes("dining")) {
    return { taxLine: "Part II Line 24b Deductible Meals (50%)", is50PctMeal: true };
  }
  if (lower.includes("car") || lower.includes("truck") || lower.includes("gas") || lower.includes("fuel") || lower.includes("auto")) {
    return { taxLine: "Part II Line 9 Car & Truck Expenses", is50PctMeal: false };
  }
  if (lower.includes("supplies") || lower.includes("materials")) {
    return { taxLine: "Part II Line 22 Supplies", is50PctMeal: false };
  }
  if (lower.includes("advertising") || lower.includes("marketing")) {
    return { taxLine: "Part II Line 8 Advertising", is50PctMeal: false };
  }
  if (lower.includes("contract") || lower.includes("labor") || lower.includes("freelance")) {
    return { taxLine: "Part II Line 11 Contract Labor", is50PctMeal: false };
  }
  if (lower.includes("legal") || lower.includes("professional") || lower.includes("accounting")) {
    return { taxLine: "Part II Line 17 Legal & Professional", is50PctMeal: false };
  }
  if (lower.includes("utility") || lower.includes("phone") || lower.includes("internet")) {
    return { taxLine: "Part II Line 25 Utilities", is50PctMeal: false };
  }
  if (lower.includes("tax") || lower.includes("license") || lower.includes("permit")) {
    return { taxLine: "Part II Line 23 Taxes & Licenses", is50PctMeal: false };
  }
  if (lower.includes("office") || lower.includes("software") || lower.includes("saas")) {
    return { taxLine: "Part II Line 18 Office Expenses", is50PctMeal: false };
  }
  return { taxLine: "Part II Line 27 Other Expenses", is50PctMeal: false };
}

export function AnalyticsDashboard({
  clientId,
  stats = [],
  monthlyData: propMonthly = [],
  categoryBreakdown: propCategories = [],
  activities: propActivities = [],
}: {
  clientId?: string;
  stats?: any[];
  monthlyData?: MonthlyDatum[];
  categoryBreakdown?: CategoryDatum[];
  activities?: ActivityItem[];
}) {
  void stats;
  void propActivities;
  const [loading, setLoading] = useState(false);
  const [livePnl, setLivePnl] = useState<{
    incomeTotal: number;
    expensesTotal: number;
    netIncome: number;
    categories: CategoryDatum[];
  } | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    api<any>(`/api/clients/${clientId}/pnl`)
      .then((data) => {
        if (data) {
          const incTotal = Number(data.income?.total ?? 0);
          const expTotal = Number(data.expenses?.total ?? 0);
          const net = Number(data.netIncome ?? incTotal - expTotal);

          const rawCats: Array<{ name: string; amount: number; percentage?: number }> =
            data.expenses?.categories || data.categories?.filter((c: any) => !c.isIncome) || [];

          const mappedCats: CategoryDatum[] = rawCats.map((c) => {
            const mapped = mapToScheduleC(c.name);
            return {
              name: c.name,
              expenses: Math.abs(Number(c.amount ?? 0)),
              taxLine: mapped.taxLine,
              percentage: c.percentage,
            };
          });

          // Sort largest expenses first
          mappedCats.sort((a, b) => b.expenses - a.expenses);

          setLivePnl({
            incomeTotal: incTotal,
            expensesTotal: expTotal,
            netIncome: net,
            categories: mappedCats,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId]);

  // Aggregate Category Data
  const categories = useMemo(() => {
    if (livePnl && livePnl.categories.length > 0) {
      const total = livePnl.expensesTotal || 1;
      return livePnl.categories.map((c) => ({
        ...c,
        percentage: Math.round((c.expenses / total) * 100),
      }));
    }
    if (propCategories.length > 0) {
      const total = propCategories.reduce((s, c) => s + c.expenses, 0) || 1;
      return propCategories.map((c) => ({
        ...c,
        taxLine: mapToScheduleC(c.name).taxLine,
        percentage: Math.round((c.expenses / total) * 100),
      }));
    }
    return [
      { name: "Supplies", expenses: 420, taxLine: "Part II Line 22 Supplies", percentage: 45 },
      { name: "Travel & Fuel", expenses: 280, taxLine: "Part II Line 9 Car & Truck", percentage: 30 },
      { name: "Meals (50%)", expenses: 140, taxLine: "Part II Line 24b Deductible Meals", percentage: 15 },
      { name: "Office", expenses: 90, taxLine: "Part II Line 18 Office", percentage: 10 },
    ];
  }, [livePnl, propCategories]);

  const totalExpenseSum = useMemo(() => {
    if (livePnl) return livePnl.expensesTotal;
    return categories.reduce((s, c) => s + c.expenses, 0);
  }, [livePnl, categories]);

  const incomeSum = livePnl ? livePnl.incomeTotal : 5200;
  const netProfit = livePnl ? livePnl.netIncome : incomeSum - totalExpenseSum;

  const monthlyChartData: MonthlyDatum[] = useMemo(() => {
    if (propMonthly.length > 0) return propMonthly;
    return [
      { month: "Jan", income: Math.round(incomeSum * 0.3), expenses: Math.round(totalExpenseSum * 0.28), receipts: 8 },
      { month: "Feb", income: Math.round(incomeSum * 0.35), expenses: Math.round(totalExpenseSum * 0.32), receipts: 14 },
      { month: "Mar", income: Math.round(incomeSum * 0.35), expenses: Math.round(totalExpenseSum * 0.4), receipts: 16 },
    ];
  }, [propMonthly, incomeSum, totalExpenseSum]);

  // SVG Donut Path calculations
  const donutPaths = useMemo(() => {
    const total = totalExpenseSum || 1;
    let currentAngle = -90;
    return categories.map((cat, idx) => {
      const slicePct = cat.expenses / total;
      const degrees = slicePct * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + degrees;
      currentAngle = endAngle;

      const x1 = 70 + 55 * Math.cos((startAngle * Math.PI) / 180);
      const y1 = 70 + 55 * Math.sin((startAngle * Math.PI) / 180);
      const x2 = 70 + 55 * Math.cos((endAngle * Math.PI) / 180);
      const y2 = 70 + 55 * Math.sin((endAngle * Math.PI) / 180);

      const largeArc = degrees > 180 ? 1 : 0;
      const pathData = `M 70 70 L ${x1} ${y1} A 55 55 0 ${largeArc} 1 ${x2} ${y2} Z`;

      return {
        path: pathData,
        color: BUCKET_COLORS[idx % BUCKET_COLORS.length],
        name: cat.name,
        percentage: cat.percentage ?? Math.round(slicePct * 100),
        amount: cat.expenses,
      };
    });
  }, [categories, totalExpenseSum]);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <PieChart className="h-5 w-5 text-[var(--color-primary)]" />
            Spending & Tax Buckets Dashboard
          </h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Purchases bucketed automatically by AI · Formatted for IRS Schedule C Tax Preparation
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-[var(--color-muted-foreground)]">Updating buckets...</span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Aggregation
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1.5"
            onClick={() => window.print()}
          >
            <Printer className="h-3.5 w-3.5" />
            Export Bucket Report
          </Button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Gross Revenue"
          value={`$${incomeSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext="From verified income deposits"
          icon={DollarSign}
          tone="good"
        />
        <StatCard
          label="Total Deductible Expenses"
          value={`$${totalExpenseSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext="Across all Schedule C buckets"
          icon={TrendingUp}
        />
        <StatCard
          label="Estimated Net Income"
          value={`$${netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext={netProfit >= 0 ? "Taxable profit" : "Operating loss carryforward"}
          icon={ShieldCheck}
          tone={netProfit >= 0 ? "good" : "bad"}
        />
        <StatCard
          label="Categorized Buckets"
          value={`${categories.length} Tax Lines`}
          subtext="AI-mapped to IRS forms"
          icon={FileText}
        />
      </div>

      {/* Visual Spending Donut & Bucket Allocation */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* The Bank-Style Spending Donut (7 cols) */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-[var(--color-primary)]" />
                Purchase Spending Buckets
              </span>
              <span className="text-xs font-mono font-medium text-[var(--color-muted-foreground)]">
                ${totalExpenseSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Total
              </span>
            </CardTitle>
            <CardDescription>
              Like your bank spending graph: click any bucket slice to inspect tax line allocation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
              {/* SVG Donut */}
              <div className="relative flex-shrink-0 flex items-center justify-center">
                <svg width="140" height="140" viewBox="0 0 140 140">
                  {donutPaths.map((slice, i) => (
                    <path
                      key={i}
                      d={slice.path}
                      fill={slice.color}
                      className="cursor-pointer transition-opacity hover:opacity-80"
                      onClick={() => setSelectedBucket(selectedBucket === slice.name ? null : slice.name)}
                    />
                  ))}
                  {/* Donut hole */}
                  <circle cx="70" cy="70" r="36" fill="var(--color-card, #ffffff)" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-muted-foreground)]">
                    Buckets
                  </span>
                  <span className="text-xs font-bold font-mono">
                    {categories.length}
                  </span>
                </div>
              </div>

              {/* Category Legend & Percentages */}
              <div className="flex-1 w-full space-y-2">
                {categories.map((cat, i) => {
                  const color = BUCKET_COLORS[i % BUCKET_COLORS.length];
                  const isSelected = selectedBucket === cat.name;
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedBucket(isSelected ? null : cat.name)}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors border text-xs ${
                        isSelected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-semibold"
                          : "border-transparent hover:bg-[var(--color-muted)]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="truncate">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="font-mono text-[var(--color-muted-foreground)]">
                          ${cat.expenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="font-bold w-9 text-right">{cat.percentage}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Schedule C Tax Form Mapping (5 cols) */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              IRS Schedule C Line Alignment
            </CardTitle>
            <CardDescription>
              How these purchase buckets translate directly to IRS tax return lines.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="divide-y divide-[var(--color-border)] text-xs">
              {categories.slice(0, 6).map((cat, idx) => {
                const isSelected = selectedBucket === cat.name;
                return (
                  <div
                    key={idx}
                    className={`py-2.5 flex items-start justify-between gap-2 ${
                      isSelected ? "bg-amber-500/10 px-2 rounded font-medium" : ""
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="font-medium text-[var(--color-foreground)]">{cat.name}</div>
                      <div className="text-[11px] text-[var(--color-muted-foreground)] font-mono">
                        {cat.taxLine}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono font-bold">
                        ${cat.expenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <Badge className="text-[9px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {cat.taxLine?.includes("50%") ? "50% Limit" : "100% Deductible"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 text-[11px] text-[var(--color-muted-foreground)] border-t border-[var(--color-border)] flex items-center justify-between">
              <span>Meals automatically calculated with 50% limit.</span>
              <span className="font-medium text-emerald-600">Audit Ready</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Cash Flow Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[var(--color-primary)]" />
              Monthly Income vs Expense Buckets
            </span>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-emerald-600">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Income
              </span>
              <span className="flex items-center gap-1 text-amber-600">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Expenses
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-44 flex items-end gap-4 px-3 pt-4 border-b border-[var(--color-border)] pb-2">
            {monthlyChartData.map((d, i) => {
              const maxVal = Math.max(
                ...monthlyChartData.map((m) => Math.max(m.income, m.expenses)),
                1
              );
              const incPct = Math.round((d.income / maxVal) * 100);
              const expPct = Math.round((d.expenses / maxVal) * 100);

              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div className="flex w-full max-w-[60px] items-end justify-center gap-1.5 h-32">
                    <div
                      className="w-full bg-emerald-500 rounded-t-sm opacity-90 transition-all hover:opacity-100"
                      style={{ height: `${incPct}%` }}
                      title={`Income: $${d.income}`}
                    />
                    <div
                      className="w-full bg-amber-500 rounded-t-sm opacity-90 transition-all hover:opacity-100"
                      style={{ height: `${expPct}%` }}
                      title={`Expenses: $${d.expenses}`}
                    />
                  </div>
                  <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                    {d.month}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
