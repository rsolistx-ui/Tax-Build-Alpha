import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Headphones,
  Send,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface SupportConciergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSubject?: string;
  defaultCategory?: string;
}

export function SupportConciergeModal({
  isOpen,
  onClose,
  defaultSubject = "",
  defaultCategory = "Custom Rule / Workflow Directive",
}: SupportConciergeModalProps) {
  const [subject, setSubject] = useState(defaultSubject);
  const [category, setCategory] = useState(defaultCategory);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      setError("Please provide a subject and description for your request.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api<{ ok: boolean; ticketNumber: string; message: string }>("/api/support/contact", {
        method: "POST",
        body: JSON.stringify({
          subject: subject.trim(),
          category,
          message: message.trim(),
        }),
      });

      setTicketNumber(data.ticketNumber);
    } catch (err: any) {
      setError(err?.message || "Failed to dispatch message to engineering desk.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setTicketNumber(null);
    setSubject("");
    setMessage("");
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="relative w-full max-w-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <button
          type="button"
          onClick={handleReset}
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              <Headphones className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">Practice Engineering Desk</CardTitle>
              <CardDescription className="text-xs">
                Direct line to our platform engineering team. We audit rule directives, tune calculations, and answer technical inquiries.
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
                <span>Ticket #{ticketNumber}</span>
                <span>·</span>
                <span>Dispatched</span>
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Engineering Inquiry Received</h3>
              <p className="text-xs text-[var(--color-muted-foreground)] max-w-sm mx-auto">
                Thank you! Your inquiry has been routed to our dedicated engineering desk. A systems engineer will verify the details and reply to your email directly.
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
                <Label htmlFor="support-category" className="text-xs font-medium">
                  Inquiry Topic
                </Label>
                <select
                  id="support-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-foreground)]"
                >
                  <option value="Custom Rule / Workflow Directive">Custom Rule / Accounting Directive</option>
                  <option value="State Tax Conformity (CA / NY)">State Tax Conformity (CA / NY)</option>
                  <option value="Bank Feeds & Reconciliation">Bank Feeds &amp; Reconciliation</option>
                  <option value="Client Portal & Native E-Sign">Client Portal &amp; Native E-Sign</option>
                  <option value="General Ledger Migration (QuickBooks / CSV)">General Ledger Migration (QuickBooks / CSV)</option>
                  <option value="General Technical Question">General Technical Question</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="support-subject" className="text-xs font-medium">
                  Subject
                </Label>
                <input
                  id="support-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Need assistance with CA LLC 568 fee calculation"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-foreground)]"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="support-message" className="text-xs font-medium">
                  Detailed Notes / Request
                </Label>
                <textarea
                  id="support-message"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe what you'd like our team to review, implement, or verify..."
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs text-[var(--color-foreground)]"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Direct Encrypted Dispatch</span>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleReset}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={loading || !subject.trim() || !message.trim()}
                    className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send to Engineering Team
                  </Button>
                </div>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
