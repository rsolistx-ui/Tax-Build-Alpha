import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { PnlCategoryRow } from "@/types/pnl";

// Validated categorical palette (dataviz skill reference/palette.md), checked
// with scripts/validate_palette.js against this app's actual card surfaces
// (#ffffff light / #131e2d dark): all 8 pass lightness, chroma, and CVD/normal
// separation in both modes. Fixed order, never cycled or regenerated.
const CATEGORY_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const OTHER_COLOR = { light: "#98968f", dark: "#5a5952" };
const MAX_SLICES = 8;

export function getCategoryColor(index: number, isDark: boolean): string {
  const palette = isDark ? CATEGORY_COLORS.dark : CATEGORY_COLORS.light;
  if (index < palette.length) return palette[index];
  return isDark ? OTHER_COLOR.dark : OTHER_COLOR.light;
}

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  useMemo(() => {
    const observer = new MutationObserver(() => setIsDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export function SpendingPieChart({ categorizedExpenses }: { categorizedExpenses: PnlCategoryRow[] }) {
  const isDark = useIsDark();

  const { slices, total } = useMemo(() => {
    const sorted = [...categorizedExpenses].sort((a, b) => b.total - a.total);
    const head = sorted.slice(0, MAX_SLICES - (sorted.length > MAX_SLICES ? 1 : 0));
    const tail = sorted.slice(head.length);
    const tailTotal = tail.reduce((sum, row) => sum + row.total, 0);
    const rows = tail.length > 0 ? [...head, { category: "Other", total: tailTotal, count: 0, receiptCount: 0, bankCount: 0 }] : head;
    const sum = rows.reduce((s, r) => s + r.total, 0);
    return { slices: rows, total: sum };
  }, [categorizedExpenses]);

  if (slices.length === 0 || total <= 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        No categorized expenses in this period.
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="total"
            nameKey="category"
            innerRadius={62}
            outerRadius={92}
            paddingAngle={1.5}
            stroke={isDark ? "#131e2d" : "#ffffff"}
            strokeWidth={2}
          >
            {slices.map((slice, i) => (
              <Cell key={slice.category} fill={slice.category === "Other" ? (isDark ? OTHER_COLOR.dark : OTHER_COLOR.light) : getCategoryColor(i, isDark)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [`$${Number(value).toFixed(2)} (${((Number(value) / total) * 100).toFixed(0)}%)`, String(name)]}
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              color: "var(--color-foreground)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">Total spend</span>
        <span className="text-lg font-semibold text-[var(--color-foreground)]">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}
