import { useState, useEffect, useCallback } from "react";
import {
  Calendar as CalendarIcon,
  Download,
  RefreshCw,
  Loader2,
  CalendarCheck,
} from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface TaxDeadline {
  id: string;
  sourceType: "engagement" | "work_item" | "tax_extension" | "invoice";
  sourceId: string;
  clientId?: string;
  clientName?: string;
  title: string;
  description?: string;
  dueDate: string;
  status: "upcoming" | "completed" | "extended" | "overdue";
  taxForm?: string;
}

export function DeadlineCalendarPanel({
  clientId,
  clientName,
}: {
  clientId?: string;
  clientName?: string;
}) {
  const [deadlines, setDeadlines] = useState<TaxDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadDeadlines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = clientId
        ? `/api/calendar/upcoming?clientId=${clientId}&days=180`
        : `/api/calendar/upcoming?days=180`;
      const res = await api<{ deadlines: TaxDeadline[] }>(url);
      setDeadlines(res.deadlines || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load deadline calendar.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadDeadlines();
  }, [loadDeadlines]);

  // Generate statutory tax deadlines
  async function handleGenerateStatutory() {
    setGenerating(true);
    try {
      const currentYear = new Date().getFullYear();
      await api("/api/calendar/generate", {
        method: "POST",
        body: JSON.stringify({ taxYear: currentYear, clientId: clientId || undefined }),
      });
      await loadDeadlines();
    } catch (err: any) {
      alert(err?.message || "Failed to generate statutory deadlines.");
    } finally {
      setGenerating(false);
    }
  }

  // Google Calendar Sync
  async function handleGoogleCalendarSync() {
    setSyncingGoogle(true);
    try {
      const res = await api<{ authUrl?: string; syncedCount?: number }>("/api/google-calendar/sync", {
        method: "POST",
      });
      if (res.authUrl) {
        window.open(res.authUrl, "_blank");
      } else {
        alert(`Successfully synced ${res.syncedCount ?? 0} deadlines to Google Calendar!`);
      }
    } catch (err: any) {
      alert(err?.message || "Google Calendar sync requires connection in Settings.");
    } finally {
      setSyncingGoogle(false);
    }
  }

  // Download iCal
  function downloadIcal() {
    const url = `${apiUrl}/api/calendar/export/ical${clientId ? `?clientId=${clientId}` : ""}`;
    window.open(url, "_blank");
  }

  // Calculate days remaining helper
  function getDaysRemaining(dueDateStr: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dueDateStr);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Statutory quick list if empty
  const defaultStatutoryDeadlines: TaxDeadline[] = [
    {
      id: "stat-1",
      sourceType: "engagement",
      sourceId: "1",
      title: "Form 1040 — Individual Federal Tax Return",
      description: "Individual income tax return deadline or Form 4868 6-month extension",
      dueDate: "2026-04-15",
      status: "upcoming",
      taxForm: "1040",
    },
    {
      id: "stat-2",
      sourceType: "engagement",
      sourceId: "2",
      title: "Form 1040-ES — Q1 Estimated Tax Payment",
      description: "First installment of estimated self-employment / small business tax",
      dueDate: "2026-04-15",
      status: "upcoming",
      taxForm: "1040-ES",
    },
    {
      id: "stat-3",
      sourceType: "engagement",
      sourceId: "3",
      title: "Form 941 — Employer Quarterly Federal Tax Return",
      description: "First quarter payroll tax reporting for wages and withholdings",
      dueDate: "2026-04-30",
      status: "upcoming",
      taxForm: "941",
    },
    {
      id: "stat-4",
      sourceType: "engagement",
      sourceId: "4",
      title: "Form 1040-ES — Q2 Estimated Tax Payment",
      description: "Second installment of 2026 estimated tax",
      dueDate: "2026-06-15",
      status: "upcoming",
      taxForm: "1040-ES",
    },
    {
      id: "stat-5",
      sourceType: "engagement",
      sourceId: "5",
      title: "Form 1040 Extended — Final Form 1040 Filing",
      description: "Six-month automatic extension deadline for Form 1040",
      dueDate: "2026-10-15",
      status: "upcoming",
      taxForm: "1040-EXT",
    },
  ];

  const displayList = deadlines.length > 0 ? deadlines : defaultStatutoryDeadlines;

  return (
    <div className="space-y-6">
      {/* Header with quick stats & actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-foreground)] flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-[var(--color-primary)]" />
            Tax Filing & Deadline Calendar
          </h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            IRS statutory filing milestones, estimated tax dates, and engagement deadlines for {clientName || "all clients"}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={downloadIcal}
            title="Download .ics calendar file"
          >
            <Download className="h-3.5 w-3.5" /> iCal (.ics)
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={handleGoogleCalendarSync}
            disabled={syncingGoogle}
          >
            {syncingGoogle ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CalendarIcon className="h-3.5 w-3.5 text-blue-500" />
            )}
            Sync Google Calendar
          </Button>

          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleGenerateStatutory}
            disabled={generating}
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Auto-Schedule Deadlines
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {/* Deadline Items List */}
      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="h-7 w-7 animate-spin mx-auto text-[var(--color-primary)]" />
          <p className="text-xs text-[var(--color-muted-foreground)] mt-2">Loading filing deadlines...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map((item) => {
            const days = getDaysRemaining(item.dueDate);
            const isOverdue = days < 0;
            const isUrgent = days >= 0 && days <= 7;

            return (
              <div
                key={item.id}
                className={`p-4 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-4 transition-all shadow-sm ${
                  isOverdue
                    ? "border-rose-300 bg-rose-500/5 dark:border-rose-900"
                    : isUrgent
                    ? "border-amber-300 bg-amber-500/5 dark:border-amber-900"
                    : "border-[var(--color-border)] bg-[var(--color-card)]"
                }`}
              >
                <div className="space-y-1 min-w-[220px]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[var(--color-foreground)]">{item.title}</span>
                    {item.taxForm ? (
                      <Badge className="font-mono text-[10px]">
                        {item.taxForm}
                      </Badge>
                    ) : null}
                    {isOverdue ? (
                      <Badge className="bg-rose-100 text-rose-800 text-[10px] border-none">Overdue ({Math.abs(days)}d ago)</Badge>
                    ) : isUrgent ? (
                      <Badge className="bg-amber-100 text-amber-800 text-[10px] border-none animate-pulse">
                        Due in {days} day{days === 1 ? "" : "s"}
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-700 text-[10px] border-none">
                        Due in {days} days
                      </Badge>
                    )}
                  </div>
                  {item.description ? (
                    <p className="text-[11px] text-[var(--color-muted-foreground)]">{item.description}</p>
                  ) : null}
                  {item.clientName ? (
                    <p className="text-[10px] font-semibold text-[var(--color-primary)]">Client: {item.clientName}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-mono font-bold text-sm text-[var(--color-foreground)]">
                      {new Date(item.dueDate + "T00:00:00").toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <span className="text-[10px] text-[var(--color-muted-foreground)]">Filing Target</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
