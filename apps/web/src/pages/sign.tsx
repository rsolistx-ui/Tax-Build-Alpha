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

type EfileLink = { authorization: { formType: string; taxYear: number; taxpayerName: string; expiresAt: string } };

export function SignPage() {
  const tokenRef = useRef<string | null>(null);
  const [data, setData] = useState<{ document: { title: string; expiresAt: string }; signer: { name: string | null; email: string } } | null>(null);
  const [efile, setEfile] = useState<EfileLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const token = signingToken(); tokenRef.current = token;
    if (!token) { setError("This signing link is missing its access token."); return; }
    // IRS Forms 8879/8878 use their own flow; every other document uses the ordinary one.
    void signingApi<EfileLink>(token, "/api/signing/efile/me").then(setEfile)
      .catch(() => signingApi<typeof data>(token, "/api/signing/me").then((result) => setData(result)))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "This signing link is unavailable."));
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
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">Truepost secure signing</p>
      <h1 className="mt-2 text-2xl font-semibold">{efile ? `Sign your Form ${efile.authorization.formType}` : "Review and sign your document"}</h1>
      {error ? <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700">{error}</p> : null}
      {!data && !efile && !error ? <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">Verifying your secure link…</p> : null}
      {efile && tokenRef.current ? <EfileHandwrittenSigning token={tokenRef.current} link={efile} onDone={() => { try { sessionStorage.removeItem(KEY); } catch {} }} /> : null}
      {data ? <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4"><p className="font-medium">{data.document.title}</p><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Prepared for {data.signer.email}. This link expires {new Date(data.document.expiresAt).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}.</p></div>
        <div className="flex flex-wrap gap-3"><button onClick={() => void reviewDocument()} disabled={opening} className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium">{opening ? "Opening…" : "Review document"}</button><button onClick={() => setOpen(true)} className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90">Continue to signature</button></div>
      </div> : null}
    </section>
    {open && data && tokenRef.current ? <NativeEsignModal clientId="public" requestId="public" documentTitle={data.document.title} defaultSignerName={data.signer.name || ""} defaultSignerEmail={data.signer.email} publicSigningToken={tokenRef.current} onClose={() => setOpen(false)} onSuccess={() => { try { sessionStorage.removeItem(KEY); } catch {} setOpen(false); setData(null); setError("Your signature has been recorded. You may close this page."); }} /> : null}
  </main>;
}

/** Pen signature: download, sign by hand, upload a photo or scan. IRS rules need no identity check for this. */
function EfileHandwrittenSigning({ token, link, onDone }: { token: string; link: EfileLink; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"download" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { formType, taxYear, taxpayerName, expiresAt } = link.authorization;

  async function download() {
    setBusy("download"); setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/signing/efile/form`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Could not download the form.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a"); a.href = url; a.download = `Form-${formType}-${taxYear}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not download the form."); }
    finally { setBusy(null); }
  }
  async function upload() {
    if (!file) return; setBusy("upload"); setError(null);
    try {
      const body = new FormData(); body.set("file", file);
      const response = await fetch(`${API_BASE}/api/signing/efile/handwritten`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Upload failed.");
      setSent(true); onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed."); }
    finally { setBusy(null); }
  }

  if (sent) return <p className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">Received. Your preparer will confirm your signed Form {formType} before filing. You can close this page.</p>;
  return <div className="mt-5 space-y-4 text-sm">
    <p className="text-[var(--color-muted-foreground)]">Tax year {taxYear} · prepared for {taxpayerName} · link expires {new Date(expiresAt).toLocaleDateString("en-US")}</p>
    <ol className="space-y-3">
      <li className="rounded-xl border border-[var(--color-border)] p-4">
        <p className="font-medium">1. Download and review</p>
        <p className="mt-1 text-[var(--color-muted-foreground)]">Check that the amounts match your return.</p>
        <button onClick={() => void download()} disabled={busy !== null} className="mt-3 inline-flex items-center justify-center rounded-md border border-[var(--color-border)] px-4 py-2 font-medium">{busy === "download" ? "Downloading…" : `Download Form ${formType}`}</button>
      </li>
      <li className="rounded-xl border border-[var(--color-border)] p-4">
        <p className="font-medium">2. Print, then sign and date it by hand</p>
        <p className="mt-1 text-[var(--color-muted-foreground)]">Use a pen on the signature line. If you file jointly, your spouse signs their own copy.</p>
      </li>
      <li className="rounded-xl border border-[var(--color-border)] p-4">
        <p className="font-medium">3. Upload a photo or scan</p>
        <p className="mt-1 text-[var(--color-muted-foreground)]">A clear phone photo of the whole page works. PDF, JPEG or PNG, up to 15 MB.</p>
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-muted)] file:px-3 file:py-1.5" />
        <button onClick={() => void upload()} disabled={!file || busy !== null} className="mt-3 inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50">{busy === "upload" ? "Uploading…" : "Send signed form"}</button>
      </li>
    </ol>
    {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700">{error}</p> : null}
  </div>;
}
