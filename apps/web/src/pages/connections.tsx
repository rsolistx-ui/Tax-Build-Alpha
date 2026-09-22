import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Mail, PlugZap, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GmailStatus = { connected: boolean; connectedAt?: string | null; scope?: string | null };
type StripeStatus = {
  configured: boolean;
  connected: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
};

/** A deliberately small integration surface: one decision and one consent screen. */
export function ConnectionsPage() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);

  useEffect(() => {
    api<GmailStatus>("/api/gmail/config")
      .then(setStatus)
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api<StripeStatus>("/api/stripe/connect/status")
      .then(setStripeStatus)
      .catch(() => setStripeStatus({ configured: false, connected: false }))
      .finally(() => setStripeLoading(false));
  }, []);

  async function connectGmail() {
    setError(null);
    try {
      const result = await api<{ authorizationUrl: string }>("/api/gmail/oauth/start");
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gmail could not be connected right now.");
    }
  }

  async function connectStripe() {
    setStripeError(null);
    try {
      const result = await api<{ authorizationUrl: string }>("/api/stripe/oauth/start", { method: "POST" });
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setStripeError(err instanceof Error ? err.message : "Stripe could not be connected right now.");
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">Connections</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tools your practice already uses</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-muted-foreground)]">Connect once, then keep the work inside Truepost. Nothing sends to a client until you approve it.</p>
      </div>

      <Card className="border-[var(--color-border)] shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef4ff] text-[#1a73e8] dark:bg-[#1a73e8]/15">
              <Mail className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">Gmail</CardTitle>
              <p className="mt-1 text-sm leading-5 text-[var(--color-muted-foreground)]">Prepare client follow-ups and bring inbox items into the review queue.</p>
            </div>
          </div>
          {status?.connected ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-success)]"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span> : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-xs text-[var(--color-muted-foreground)] sm:grid-cols-3">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Google consent</span>
            <span>Encrypted refresh token</span>
            <span>Drafts need approval</span>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p> : null}
          {status?.connected ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Gmail is connected. You can review inbox triage in Agent Desk and prepare drafts from a client workspace.</p>
          ) : (
            <Button onClick={connectGmail} disabled={loading}>
              <PlugZap className="h-4 w-4" /> {loading ? "Checking connection…" : "Connect Gmail"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-[var(--color-border)] shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f6f3ff] text-[#635bff] dark:bg-[#635bff]/15">
              <CreditCard className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">Stripe</CardTitle>
              <p className="mt-1 text-sm leading-5 text-[var(--color-muted-foreground)]">View payments and keep client billing in the same workspace.</p>
            </div>
          </div>
          {stripeStatus?.connected ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-success)]"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span> : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-xs text-[var(--color-muted-foreground)] sm:grid-cols-3">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Stripe authorization</span>
            <span>No banking details in Truepost</span>
            <span>Disconnect anytime</span>
          </div>
          {stripeError ? <p role="alert" className="text-sm text-[var(--color-destructive)]">{stripeError}</p> : null}
          {stripeStatus?.connected ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Stripe is connected{stripeStatus.chargesEnabled && stripeStatus.payoutsEnabled ? " and ready to accept payments." : ". Stripe may still need a final account review."}</p>
          ) : stripeStatus?.configured === false ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">Stripe is not enabled for this practice yet. An owner can enable it without asking anyone for banking details.</p>
          ) : (
            <Button onClick={connectStripe} disabled={stripeLoading}>
              <PlugZap className="h-4 w-4" /> {stripeLoading ? "Checking connection…" : "Connect Stripe"}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
