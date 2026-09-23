import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One-time two-step sign-in setup. Tax preparers are covered by the FTC
 * Safeguards Rule, which requires multi-factor authentication for anyone
 * accessing client information (16 CFR 314.4(c)(5)). The second step is a
 * code emailed to the account address; entering it proves the inbox works
 * and turns two-step sign-in on.
 */
export function MfaEnrollment() {
  const { data: session } = authClient.useSession();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true); setError(null);
    const { error: err } = await authClient.twoFactor.sendOtp();
    setBusy(false);
    if (err) { setError(err.message || "We could not send the code. Try again."); return; }
    setSent(true);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const { error: err } = await authClient.twoFactor.verifyOtp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (err) { setError(err.message || "That code did not work. Check the newest email or send a new code."); return; }
    window.location.reload();
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" />
          <h1 className="text-lg font-semibold">Confirm your email</h1>
        </div>
        <p className="mb-5 text-sm text-[var(--color-muted-foreground)]">
          Federal rules for tax preparers require a second sign-in step to protect client information. Each time you sign in, we email you a 6-digit code. No app needed.
        </p>

        {!sent ? (
          <div className="space-y-3">
            <p className="text-sm">We will send a code to <span className="font-medium">{session?.user.email}</span>.</p>
            {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
            <Button type="button" className="w-full" disabled={busy} onClick={() => void sendCode()}>{busy ? "Sending…" : "Email me a code"}</Button>
          </div>
        ) : (
          <form onSubmit={(e) => void confirm(e)} className="space-y-3">
            <Label htmlFor="mfa-code" className="text-xs font-medium">6-digit code from your email</Label>
            <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
            <p className="text-xs text-[var(--color-muted-foreground)]">The code expires in 10 minutes. Check your spam folder if it has not arrived.</p>
            {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy || code.replace(/\s/g, "").length < 6}>{busy ? "Checking…" : "Confirm"}</Button>
            <button type="button" className="w-full text-center text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" disabled={busy} onClick={() => { setCode(""); void sendCode(); }}>Send a new code</button>
          </form>
        )}
      </section>
    </div>
  );
}
