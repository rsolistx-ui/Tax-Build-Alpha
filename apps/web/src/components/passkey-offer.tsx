import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { deviceSupportsFingerprint } from "@/lib/passkey-support";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "truepost_passkey_offer_dismissed";

/** Offers fingerprint sign-in once, only on devices that support it and only if this account has none yet. */
export function PasskeyOffer() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try { if (localStorage.getItem(DISMISS_KEY)) return; } catch { /* storage unavailable: still offer */ }
      if (!(await deviceSupportsFingerprint())) return;
      const { data } = await authClient.passkey.listUserPasskeys();
      if (!cancelled && Array.isArray(data) && data.length === 0) setShow(true);
    })();
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  }

  async function turnOn() {
    setBusy(true); setError(null);
    const result = await authClient.passkey.addPasskey({ name: "This device", authenticatorAttachment: "platform" });
    setBusy(false);
    if (result?.error) { setError(result.error.message || "Fingerprint sign-in was not turned on. Try again."); return; }
    setDone(true);
  }

  if (!show) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <Fingerprint className="h-6 w-6 shrink-0 text-[var(--color-primary)]" />
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium">{done ? "Fingerprint sign-in is on for this device" : "Sign in with your fingerprint"}</p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {done ? "Next time, choose Sign in with fingerprint. No password or email code." : "Use this device's fingerprint, face or PIN instead of a password and email code."}
        </p>
        {error ? <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </div>
      {done ? (
        <Button size="sm" variant="outline" onClick={() => setShow(false)}>Close</Button>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
          <Button size="sm" disabled={busy} onClick={() => void turnOn()}>{busy ? "Waiting for your device…" : "Turn on"}</Button>
        </div>
      )}
    </div>
  );
}
