import { useEffect, useRef, useState } from "react";
import { NativeEsignModal } from "@/components/native-esign-modal";
import { API_BASE } from "@/lib/api";

const KEY = "truepost_signing_token";
function signingToken(): string | null {
  const hash = window.location.hash;
  if (hash.startsWith("#token=")) {
    const value = decodeURIComponent(hash.slice(7));
    try { sessionStorage.setItem(KEY, value); } catch { /* session-only memory still works */ }
    window.history.replaceState(null, "", window.location.pathname);
    return value;
  }
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
async function signingApi<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "This signing link is unavailable.");
  return body as T;
}

export function SignPage() {
  const tokenRef = useRef<string | null>(null);
  const [data, setData] = useState<{ document: { title: string; expiresAt: string }; signer: { name: string | null; email: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const token = signingToken(); tokenRef.current = token;
    if (!token) { setError("This signing link is missing its access token."); return; }
    void signingApi<typeof data>(token, "/api/signing/me").then((result) => setData(result)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "This signing link is unavailable."));
  }, []);
  async function reviewDocument() {
    if (!tokenRef.current) return; setOpening(true); setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/signing/document`, { headers: { Authorization: `Bearer ${tokenRef.current}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Could not open this document.");
      const url = URL.createObjectURL(await response.blob()); window.open(url, "_blank", "noopener,noreferrer"); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open this document."); }
    finally { setOpening(false); }
  }
  return <main className="min-h-screen bg-[var(--color-background)] px-4 py-10 text-[var(--color-foreground)]">
    <section className="mx-auto max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Truepost secure signing</p>
      <h1 className="mt-2 text-2xl font-semibold">Review and sign your document</h1>
      {error ? <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700">{error}</p> : null}
      {!data && !error ? <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">Verifying your secure link…</p> : null}
      {data ? <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4"><p className="font-medium">{data.document.title}</p><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Prepared for {data.signer.email}. This link expires {new Date(data.document.expiresAt).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}.</p></div>
        <div className="flex flex-wrap gap-3"><button onClick={() => void reviewDocument()} disabled={opening} className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium">{opening ? "Opening…" : "Review document"}</button><button onClick={() => setOpen(true)} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Continue to signature</button></div>
      </div> : null}
    </section>
    {open && data && tokenRef.current ? <NativeEsignModal clientId="public" requestId="public" documentTitle={data.document.title} defaultSignerName={data.signer.name || ""} defaultSignerEmail={data.signer.email} publicSigningToken={tokenRef.current} onClose={() => setOpen(false)} onSuccess={() => { try { sessionStorage.removeItem(KEY); } catch {} setOpen(false); setData(null); setError("Your signature has been recorded. You may close this page."); }} /> : null}
  </main>;
}
