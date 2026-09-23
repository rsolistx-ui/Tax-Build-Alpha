import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One-time two-step sign-in setup. Tax preparers are covered by the FTC
 * Safeguards Rule, which requires multi-factor authentication for anyone
 * accessing client information (16 CFR 314.4(c)(5)).
 */
export function MfaEnrollment() {
  const [step, setStep] = useState<"password" | "scan" | "done">("password");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ uri: string; secret: string; backupCodes: string[] } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!setup) return;
    void QRCode.toDataURL(setup.uri, { margin: 1, width: 208 }).then(setQr).catch(() => setQr(null));
  }, [setup]);

  async function start(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({ password, method: "totp" });
    setBusy(false);
    if (err || !data || data.method !== "totp") { setError(err?.message || "That password did not work."); return; }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ uri: data.totpURI, secret, backupCodes: data.backupCodes });
    setPassword("");
    setStep("scan");
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (err) { setError(err.message || "That code did not work. Try the newest code in your app."); return; }
    setStep("done");
    window.location.reload();
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" />
          <h1 className="text-lg font-semibold">Set up two-step sign-in</h1>
        </div>
        <p className="mb-5 text-sm text-[var(--color-muted-foreground)]">
          Federal rules for tax preparers require a second sign-in step to protect client information. It takes about a minute with any authenticator app.
        </p>

        {step === "password" ? (
          <form onSubmit={(e) => void start(e)} className="space-y-3">
            <Label htmlFor="mfa-password" className="text-xs font-medium">Confirm your password</Label>
            <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy || !password}>{busy ? "Starting…" : "Continue"}</Button>
          </form>
        ) : null}

        {step === "scan" && setup ? (
          <form onSubmit={(e) => void confirm(e)} className="space-y-4">
            <ol className="list-decimal space-y-3 pl-5 text-sm">
              <li>
                Scan this with your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar).
                <div className="mt-2 flex justify-center rounded-lg bg-white p-3">{qr ? <img src={qr} alt="Setup code for your authenticator app" width={208} height={208} /> : null}</div>
                <p className="mt-1 break-all text-xs text-[var(--color-muted-foreground)]">Can't scan? Enter this key: <span className="font-mono">{setup.secret}</span></p>
              </li>
              <li>
                Save these backup codes somewhere safe. Each works once if you lose your phone.
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-[var(--color-muted)]/40 p-3 font-mono text-xs">{setup.backupCodes.map((c) => <span key={c}>{c}</span>)}</div>
                <div className="mt-2 flex items-center justify-between">
                  <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(setup.backupCodes.join("\n"))}>Copy codes</Button>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved them</label>
                </div>
              </li>
              <li>
                Enter the 6-digit code your app shows now.
                <Input className="mt-2" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </li>
            </ol>
            {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy || !saved || code.replace(/\s/g, "").length < 6}>{busy ? "Checking…" : "Turn on two-step sign-in"}</Button>
          </form>
        ) : null}

        {step === "done" ? <p className="text-sm text-emerald-700 dark:text-emerald-300">Two-step sign-in is on. Opening your workspace…</p> : null}
      </section>
    </div>
  );
}
