import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";

/*
 * Taxpayer consent screen (IRC § 7216, Rev. Proc. 2013-14 § 5.03 and § 6).
 * Each consent is its own screen containing only that consent. The taxpayer
 * checks the box and types their own name; nothing is pre-filled.
 */
const KEY = "truepost_consent_token";
function consentToken(): string | null {
  const hash = window.location.hash;
  if (hash.startsWith("#token=")) {
    const value = decodeURIComponent(hash.slice(7));
    try { sessionStorage.setItem(KEY, value); } catch { /* session memory is enough */ }
    window.history.replaceState(null, "", window.location.pathname);
    return value;
  }
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

type ConsentDoc = { kind: "disclosure_document_reading" | "use_bookkeeping"; title: string; text: string; authorization: string };
type Me = { preparerName: string; taxpayerName: string; expiresAt: string; documents: ConsentDoc[]; signedKinds: string[] };

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/api/consent${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "This consent link is unavailable. Ask your preparer for a new link.");
  return data as T;
}

export function ConsentPage() {
  const token = useRef<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [index, setIndex] = useState(0);
  const [signed, setSigned] = useState<Record<string, { text: string; expiresOn: string } | "declined">>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    token.current = consentToken();
    if (!token.current) { setError("This consent link is missing its access code."); return; }
    void call<Me>(token.current, "/me").then((data) => {
      setMe(data);
      setSigned(Object.fromEntries(data.signedKinds.map((k) => [k, { text: "", expiresOn: "" }])));
    }).catch((e: Error) => setError(e.message));
  }, []);

  async function finish() {
    if (token.current) await call(token.current, "/finish", {}).catch(() => undefined);
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setDone(true);
  }

  const doc = me?.documents[index];
  const outcome = doc ? signed[doc.kind] : undefined;

  return (
    <main className="min-h-screen bg-[var(--color-background)] px-4 py-8 text-[var(--color-foreground)]">
      <article className="mx-auto max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl print:border-0 print:shadow-none">
        {error ? <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">{error}</p> : null}
        {!me && !error ? <p className="text-[var(--color-muted-foreground)]">Opening your consent form…</p> : null}
        {done ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-200">Thank you. Your choices were sent to {me?.preparerName}. You can close this page.</p> : null}

        {me && doc && !done ? (
          <>
            <p className="mb-4 text-sm text-[var(--color-muted-foreground)] print:hidden">Form {index + 1} of {me.documents.length}</p>
            <ConsentText text={outcome && outcome !== "declined" && outcome.text ? outcome.text : doc.text} />
            {outcome === undefined ? (
              <SignForm key={doc.kind} doc={doc} onDecline={() => setSigned((s) => ({ ...s, [doc.kind]: "declined" }))}
                onSign={async (typedName, expiresOn) => {
                  const result = await call<{ consentText: string; expiresOn: string }>(token.current!, "/sign", { kind: doc.kind, authorized: true, typedName, expiresOn });
                  setSigned((s) => ({ ...s, [doc.kind]: { text: result.consentText, expiresOn: result.expiresOn } }));
                }} />
            ) : (
              <div className="mt-6 space-y-3 print:hidden">
                <p className={`rounded-lg p-3 text-sm ${outcome === "declined" ? "bg-[var(--color-muted)]" : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"}`}>
                  {outcome === "declined" ? "You did not give this consent. Nothing was signed." : outcome.expiresOn ? `Signed. Valid until ${outcome.expiresOn}. Print or save a copy for your records.` : "You already signed this form with this link."}
                </p>
                <div className="flex flex-wrap gap-3">
                  {outcome !== "declined" ? <button type="button" onClick={() => window.print()} className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium">Print or save a copy</button> : null}
                  {index < me.documents.length - 1
                    ? <button type="button" onClick={() => setIndex(index + 1)} className="inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)]">Next form</button>
                    : <button type="button" onClick={() => void finish()} className="inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)]">Done</button>}
                </div>
              </div>
            )}
          </>
        ) : null}
      </article>
    </main>
  );
}

function ConsentText({ text }: { text: string }) {
  const [title, ...paragraphs] = text.split("\n\n");
  return (
    <div className="space-y-3 text-base leading-relaxed">
      <h1 className="text-lg font-semibold tracking-wide">{title}</h1>
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}

function SignForm({ doc, onSign, onDecline }: { doc: ConsentDoc; onSign: (typedName: string, expiresOn: string | null) => Promise<void>; onDecline: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [custom, setCustom] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toLocaleDateString("en-US");

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try { await onSign(typedName, custom && endDate ? endDate : null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record your consent."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4 border-t border-[var(--color-border)] pt-5 text-base print:hidden">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1.5 h-5 w-5 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{doc.authorization.replace("{name}", typedName.trim() || "[your name]")}</span>
      </label>
      <label className="block">
        <span className="text-sm font-medium">Type your full name to sign</span>
        <input className="mt-1 h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-base" value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="off" />
      </label>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">How long should this consent last?</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={!custom} onChange={() => setCustom(false)} /> One year from today</label>
        <label className="flex flex-wrap items-center gap-2"><input type="radio" checked={custom} onChange={() => setCustom(true)} /> Until
          <input type="date" className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2" value={endDate} disabled={!custom} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </fieldset>
      <p className="text-sm text-[var(--color-muted-foreground)]">Date: {today}</p>
      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || !agreed || typedName.trim().length < 2 || (custom && !endDate)}
          className="inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50">
          {busy ? "Signing…" : "Sign"}
        </button>
        <button type="button" onClick={onDecline} className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm font-medium">I do not consent</button>
      </div>
    </form>
  );
}
