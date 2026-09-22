import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Sparkles,
  Send,
  ShieldCheck,
  FileCode2,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

interface ClientRuleRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientId?: string;
  clientName?: string;
  onSubmitted?: () => void;
}

export function ClientRuleRequestModal({
  isOpen,
  onClose,
  clientId,
  clientName,
  onSubmitted,
}: ClientRuleRequestModalProps) {
  const [directiveText, setDirectiveText] = useState("");
  const [ruleType, setRuleType] = useState<"categorization" | "personal_vs_business" | "tax_deduction" | "general">("categorization");
  const [loading, setLoading] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus(isOpen, handleReset);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!directiveText.trim()) {
      setError("Please describe the bookkeeping rule or tax directive you'd like created.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api<{ ok: boolean; ticketNumber: string; message: string }>("/api/support/request-rule", {
        method: "POST",
        body: JSON.stringify({
          clientId: clientId || undefined,
          clientName: clientName || undefined,
          directiveText: directiveText.trim(),
          ruleType,
        }),
      });

      setTicketNumber(data.ticketNumber);
      if (onSubmitted) onSubmitted();
    } catch (err: any) {
      setError(err?.message || "Failed to submit rule directive request.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setTicketNumber(null);
    setDirectiveText("");
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-rule-request-title"
        aria-describedby="client-rule-request-description"
        className="contents"
      >
      <Card className="relative w-full max-w-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <button
          type="button"
          onClick={handleReset}
          data-dialog-autofocus
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <CardTitle id="client-rule-request-title" className="text-base">Request Custom Accounting Directive</CardTitle>
              <CardDescription id="client-rule-request-description" className="text-xs">
                {clientName ? `Queue a deterministic rule for ${clientName}.` : "Queue a custom firm-wide compliance rule."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-md bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {ticketNumber ? (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <span>Directive #{ticketNumber}</span>
                <span>·</span>
                <span>Queued &amp; Confirmed</span>
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Directive Queued with Operations Desk</h3>
              <p className="text-xs text-[var(--color-muted-foreground)] max-w-sm mx-auto">
                An automated confirmation has been sent to your email. Safe, client-scoped intake rules activate for future suggestions after validation; anything affecting tax treatment or historical records stays in review.
              </p>
              <div className="pt-2 flex justify-center gap-2">
                <Button size="sm" onClick={handleReset}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="rule-type-select" className="text-xs font-medium">
                  Directive Classification
                </Label>
                <select
                  id="rule-type-select"
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as any)}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-foreground)]"
                >
                  <option value="categorization">Vendor / Merchant Categorization (Schedule C)</option>
                  <option value="personal_vs_business">Business vs. Personal Commingling Filter</option>
                  <option value="tax_deduction">Tax Safe Harbor / Depreciation Boundary</option>
                  <option value="general">Custom Workflow / Threshold Directive</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-directive-text" className="text-xs font-medium">
                  What should this rule do?
                </Label>
                <textarea
                  id="rule-directive-text"
                  rows={4}
                  value={directiveText}
                  onChange={(e) => setDirectiveText(e.target.value)}
                  placeholder="e.g. For this client, categorize all transactions from Shell, Exxon, and Chevron to Car & Truck Expenses (Line 9). If any single receipt is over $250, flag it for manual mileage log verification."
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs text-[var(--color-foreground)]"
                />
              </div>

              <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-2.5 dark:border-purple-900/40 dark:bg-purple-950/20 text-[11px] text-purple-900 dark:text-purple-300">
                <div className="flex items-center gap-1.5 font-medium mb-0.5">
                  <FileCode2 className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                  White-Glove RuleForge Compilation
                </div>
                <span>Your directive is formatted into deterministic logic and tested against historical transactions before deployment.</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Instant Email Confirmation</span>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleReset}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={loading || !directiveText.trim()}
                    className="gap-1.5 bg-purple-700 hover:bg-purple-800 text-white"
                  >
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Submit Directive
                  </Button>
                </div>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
