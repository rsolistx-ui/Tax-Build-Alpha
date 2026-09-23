import { useEffect, useState } from "react";
import { Copy, FileText, Link2, Printer, Upload } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/formatters";

type Consent = {
  id: string; consent_kind: "disclosure_document_reading" | "use_bookkeeping"; taxpayer_name: string; signature_method: string;
  signed_at: string; expires_on: string; revoked_at: string | null; revocation_note: string | null;
};
type Status = { required: boolean; covered: boolean; readers: Array<{ legalName: string; service: string }> };

const KIND_LABEL = { disclosure_document_reading: "Disclosure (automatic reading)", use_bookkeeping: "Use (bookkeeping)" } as const;
const inputClass = "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm";

/** Client consent under IRC § 7216. Automatic receipt reading stays off until the disclosure consent is signed. */
export function ClientConsentCard({ clientId, compact = false }: { clientId: string; compact?: boolean }) {
  const [consents, setConsents] = useState<Consent[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [paper, setPaper] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const base = `/api/clients/${clientId}/consents`;

  async function load() {
    try { const data = await api<{ consents: Consent[]; documentReading: Status; emailConfigured: boolean }>(base); setConsents(data.consents); setStatus(data.documentReading); setEmailConfigured(data.emailConfigured); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not load consents." }); }
  }
  useEffect(() => { void load(); }, [clientId]);

  const today = new Date().toISOString().slice(0, 10);
  const active = consents.filter((c) => !c.revoked_at && c.expires_on >= today);
  const disclosure = active.find((c) => c.consent_kind === "disclosure_document_reading");

  const state = !status ? null : !status.required ? { label: status.readers.length ? "Not needed: reading stays in the US" : "Not in use", tone: status.readers.length ? "on" : "neutral" } : status.covered
    ? { label: `Automatic reading on${disclosure ? ` until ${formatDate(disclosure.expires_on)}` : ""}`, tone: "on" }
    : { label: "Automatic reading off: waiting for client consent", tone: "off" };
  const toneClass = { on: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", off: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", neutral: "border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" };

  async function createLink() {
    setMessage(null);
    try { const r = await api<{ consentUrl: string; expiresAt: string }>(`${base}/link`, { method: "POST" }); setLink({ url: r.consentUrl, expiresAt: r.expiresAt }); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not create the link." }); }
  }
  async function openPrintable(kind: Consent["consent_kind"]) {
    const res = await fetch(apiUrl(`${base}/printable?kind=${kind}`), { credentials: "include" });
    if (!res.ok) { setMessage({ tone: "error", text: "Could not open the printable form." }); return; }
    const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/html" }));
    window.open(url, "_blank", "noopener,noreferrer"); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[var(--color-primary)]" />
          <h3 className="text-sm font-semibold">Client consent</h3>
          {state ? <Badge className={toneClass[state.tone as keyof typeof toneClass]}>{state.label}</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void createLink()}><Link2 className="h-3.5 w-3.5" />Send consent link</Button>
          {!compact ? <>
            <Button size="sm" variant="outline" onClick={() => void openPrintable("disclosure_document_reading")}><Printer className="h-3.5 w-3.5" />Print form</Button>
            <Button size="sm" variant="outline" onClick={() => setPaper((v) => !v)}><Upload className="h-3.5 w-3.5" />Record paper consent</Button>
          </> : null}
        </div>
      </div>

      {status?.required && !status.covered ? (
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          Federal law (IRC § 7216) requires the client's signed consent before receipts go to outside reading services. Until then, uploads are saved for manual entry.{" "}
          {emailConfigured ? "The link is emailed to the client automatically each morning." : "The client is asked in their portal; email is not set up, so automatic emails are off."}
        </p>
      ) : null}

      {link ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-[var(--color-muted)]/40 p-2 text-xs">
          <span className="min-w-0 flex-1 truncate font-mono">{link.url}</span>
          <span className="text-[var(--color-muted-foreground)]">Expires {formatDate(link.expiresAt)}</span>
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(link.url).then(() => setMessage({ tone: "ok", text: "Link copied. Send it to the client." }))}><Copy className="h-3.5 w-3.5" />Copy</Button>
        </div>
      ) : null}

      {message ? <p className={`mt-2 text-xs ${message.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600"}`} role={message.tone === "error" ? "alert" : undefined}>{message.text}</p> : null}

      {paper && !compact ? <PaperForm base={base} onDone={() => { setPaper(false); setMessage({ tone: "ok", text: "Paper consent recorded." }); void load(); }} onCancel={() => setPaper(false)} onOpenPrintable={openPrintable} /> : null}

      {!compact && consents.length ? (
        <ul className="mt-3 divide-y divide-[var(--color-border)] text-xs">
          {consents.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{KIND_LABEL[c.consent_kind]}</span> · {c.taxpayer_name} · {c.signature_method === "paper" ? "paper" : "typed name"} · signed {formatDate(c.signed_at)} · until {formatDate(c.expires_on)}
                {c.revoked_at ? <span className="text-rose-600"> · revoked {formatDate(c.revoked_at)}</span> : c.expires_on < today ? <span className="text-amber-600"> · expired</span> : null}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => window.open(apiUrl(`${base}/${c.id}/text`), "_blank", "noopener,noreferrer")}>View signed text</Button>
                {!c.revoked_at ? (revoking === c.id
                  ? <RevokeForm onCancel={() => setRevoking(null)} onSubmit={async (note) => {
                      try { await api(`${base}/${c.id}/revoke`, { method: "POST", body: JSON.stringify({ note }) }); setRevoking(null); void load(); }
                      catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not revoke." }); }
                    }} />
                  : <Button size="sm" variant="ghost" onClick={() => setRevoking(c.id)}>Record revocation</Button>) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RevokeForm({ onSubmit, onCancel }: { onSubmit: (note: string) => Promise<void>; onCancel: () => void }) {
  const [note, setNote] = useState("");
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void onSubmit(note.trim()); }}>
      <input autoFocus className={`${inputClass} h-8 w-56 text-xs`} placeholder="How the client revoked" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" type="submit" disabled={!note.trim()}>Save</Button>
      <Button size="sm" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
    </form>
  );
}

function PaperForm({ base, onDone, onCancel, onOpenPrintable }: { base: string; onDone: () => void; onCancel: () => void; onOpenPrintable: (kind: Consent["consent_kind"]) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(null);
    try { await api(`${base}/paper`, { method: "POST", body: new FormData(e.currentTarget) }); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record the consent."); }
    finally { setSaving(false); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 grid gap-2 rounded-md border border-[var(--color-border)] p-3 text-xs sm:grid-cols-2">
      <label>Form<select name="kind" className={inputClass} defaultValue="disclosure_document_reading">
        <option value="disclosure_document_reading">Disclosure (automatic reading)</option><option value="use_bookkeeping">Use (bookkeeping)</option></select></label>
      <label>Name as signed<input name="taxpayerName" className={inputClass} required /></label>
      <label>Date signed<input name="signedOn" type="date" className={inputClass} required /></label>
      <label>End date written on form (blank = one year)<input name="expiresOn" type="date" className={inputClass} /></label>
      <label className="sm:col-span-2">Signed form (PDF, JPEG or PNG)<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="block w-full text-sm" /></label>
      <p className="text-[var(--color-muted-foreground)] sm:col-span-2">Use the unaltered printed form. <button type="button" className="font-medium text-[var(--color-primary)]" onClick={() => void onOpenPrintable("use_bookkeeping")}>Print the use form</button></p>
      {error ? <p role="alert" className="text-rose-600 sm:col-span-2">{error}</p> : null}
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Record consent"}</Button></div>
    </form>
  );
}
