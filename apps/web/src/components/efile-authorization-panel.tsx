import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileSignature, ShieldCheck, Upload, Link2, UserCheck, Globe, FileDown, FileJson, Check, X, Copy } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/formatters";

type Status = "awaiting_signature" | "handwritten_received" | "signed" | "voided";
type Method = "handwritten_upload" | "in_person_esign" | "remote_kba_esign";
type IdentityCheck = { type: "photo_id_inspected" | "multi_year_relationship" | "kba_passed" | "not_required_handwritten"; [key: string]: unknown };

interface Authorization {
  id: string; tax_return_id: string | null; tax_year: number; form_type: "8879" | "8878";
  taxpayer_role: "primary" | "spouse"; taxpayer_name: string; taxpayer_email: string | null;
  status: Status; signed_method: Method | null; received_at: string | null; received_content_type: string | null;
  kba_failed_attempts: number; created_at: string; void_reason: string | null;
  evidence: { id: string; method: Method; signedAt: string; signerName: string; identityCheck: IdentityCheck; signedHash: string; retainUntil: string } | null;
}
interface RemoteSigning { enabled: boolean; reason?: string; provider?: string }
interface TaxReturn { id: string; tax_year: number; form_type: string; status: string }

const STATUS: Record<Status, { label: string; className: string }> = {
  awaiting_signature: { label: "Awaiting signature", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  handwritten_received: { label: "Signed copy to review", className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  signed: { label: "Signed and sealed", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  voided: { label: "Voided", className: "border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" },
};
const METHOD: Record<Method, string> = {
  handwritten_upload: "Pen signature",
  in_person_esign: "In office e-sign",
  remote_kba_esign: "Remote e-sign",
};

function identitySummary(check: IdentityCheck): string {
  switch (check.type) {
    case "photo_id_inspected": return `Photo ID inspected (${String(check.idType).replace(/_/g, " ")} ending ${check.idNumberLast4})`;
    case "multi_year_relationship": return `Returning client, ID verified ${check.priorTaxYear}`;
    case "kba_passed": return `Identity questions passed (${check.provider})`;
    case "not_required_handwritten": return "No ID check needed: handwritten";
  }
}

async function openFile(path: string, download?: string) {
  const res = await fetch(apiUrl(path), { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not open the file.");
  const url = URL.createObjectURL(await res.blob());
  if (download) { const a = document.createElement("a"); a.href = url; a.download = download; a.click(); }
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function EfileAuthorizationPanel({ clientId, defaultTaxYear }: { clientId: string; defaultTaxYear: number }) {
  const [items, setItems] = useState<Authorization[]>([]);
  const [remote, setRemote] = useState<RemoteSigning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [inPerson, setInPerson] = useState<Authorization | null>(null);
  const [uploading, setUploading] = useState<Authorization | null>(null);
  const [reasonFor, setReasonFor] = useState<{ item: Authorization; action: "reject" | "void" } | null>(null);
  const [link, setLink] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [verified, setVerified] = useState<Record<string, { intact: boolean; checkedAt: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/clients/${clientId}/efile-authorizations`;

  async function load() {
    try {
      const data = await api<{ authorizations: Authorization[]; remoteSigning: RemoteSigning }>(base);
      setItems(data.authorizations); setRemote(data.remoteSigning); setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load e-file signatures."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [clientId]);

  async function run(key: string, action: () => Promise<unknown>, success?: string) {
    setBusy(key); setError(null); setNotice(null);
    try { await action(); if (success) setNotice(success); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That did not work."); }
    finally { setBusy(null); }
  }

  const live = items.filter((i) => i.status !== "voided");
  const count = (status: Status) => live.filter((i) => i.status === status).length;

  return (
    <Card className="border-[var(--color-border)] bg-[var(--color-card)]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><FileSignature className="h-5 w-5" /></div>
            <div>
              <CardTitle className="text-base font-semibold">IRS e-file signatures</CardTitle>
              <CardDescription className="text-xs">Forms 8879 and 8878 · IRS Publication 1345 · returns cannot transmit until signed</CardDescription>
            </div>
          </div>
          <Button size="sm" onClick={() => setPreparing((v) => !v)}>{preparing ? "Close" : "Prepare authorization"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Awaiting signature" value={String(count("awaiting_signature"))} tone={count("awaiting_signature") ? "amber" : "neutral"} />
          <Stat label="Copies to review" value={String(count("handwritten_received"))} tone={count("handwritten_received") ? "sky" : "neutral"} />
          <Stat label="Signed and sealed" value={String(count("signed"))} tone="emerald" />
          <Stat label="Remote e-sign" value={remote?.enabled ? "On" : "Off"} tone={remote?.enabled ? "emerald" : "neutral"} hint={remote?.enabled ? remote.provider : "Needs identity vendor"} />
        </div>

        {error ? <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
        {notice ? <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p> : null}

        {preparing ? <PrepareForm clientId={clientId} base={base} defaultTaxYear={defaultTaxYear} onDone={() => { setPreparing(false); setNotice("Authorization prepared."); void load(); }} /> : null}

        {link ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm">
            <Link2 className="h-4 w-4 text-[var(--color-primary)]" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{link.url}</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">Expires {formatDateTime(link.expiresAt)}</span>
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(link.url).then(() => setNotice("Link copied. Send it to the taxpayer."))}><Copy className="h-3.5 w-3.5" />Copy</Button>
          </div>
        ) : null}

        {loading ? <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p> : null}
        {!loading && !items.length ? (
          <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-foreground)]">
            No authorizations yet. Upload the Form 8879 from your tax software to start.
          </p>
        ) : null}

        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Form {item.form_type} · {item.tax_year} · {item.taxpayer_name} <span className="text-[var(--color-muted-foreground)]">({item.taxpayer_role})</span></p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {item.tax_return_id ? "Linked to return" : "Not linked to a return"} · prepared {formatDate(item.created_at)}
                    {item.status === "handwritten_received" && item.received_at ? ` · copy received ${formatDateTime(item.received_at)}` : ""}
                    {item.status === "voided" && item.void_reason ? ` · ${item.void_reason}` : ""}
                  </p>
                </div>
                <Badge className={STATUS[item.status].className}>{STATUS[item.status].label}</Badge>
              </div>

              {item.evidence ? (
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <Field label="Method" value={METHOD[item.evidence.method]} />
                  <Field label="Signed" value={formatDateTime(item.evidence.signedAt)} />
                  <Field label="Identity" value={identitySummary(item.evidence.identityCheck)} />
                  <Field label="Keep until" value={formatDate(item.evidence.retainUntil)} />
                </dl>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {item.status === "awaiting_signature" ? <>
                  <Button size="sm" variant="outline" disabled={busy !== null || !item.taxpayer_email} title={item.taxpayer_email ? "Taxpayer downloads, signs by hand, uploads a photo" : "Add the taxpayer's email to send a link"}
                    onClick={() => void run(item.id, async () => { const r = await api<{ signingUrl: string; expiresAt: string }>(`${base}/${item.id}/signing-link`, { method: "POST" }); setLink({ id: item.id, url: r.signingUrl, expiresAt: r.expiresAt }); })}>
                    <Link2 className="h-3.5 w-3.5" />Pen-sign link
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setUploading(item)}><Upload className="h-3.5 w-3.5" />Upload signed copy</Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setInPerson(item)}><UserCheck className="h-3.5 w-3.5" />Sign in office</Button>
                  <Button size="sm" variant="outline" disabled title={remote?.enabled ? "Remote signing opens from the taxpayer's link" : `Off: ${remote?.reason ?? "no identity vendor"}`}><Globe className="h-3.5 w-3.5" />Remote e-sign</Button>
                </> : null}
                {item.status === "handwritten_received" ? <>
                  <Button size="sm" variant="outline" onClick={() => void openFile(`${base}/${item.id}/received`).catch((e) => setError(e.message))}><FileDown className="h-3.5 w-3.5" />View received copy</Button>
                  <Button size="sm" disabled={busy !== null} onClick={() => void run(item.id, () => api(`${base}/${item.id}/handwritten/accept`, { method: "POST" }), "Signed copy accepted and sealed.")}><Check className="h-3.5 w-3.5" />Signed and dated: accept</Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setReasonFor({ item, action: "reject" })}><X className="h-3.5 w-3.5" />Reject</Button>
                </> : null}
                {item.status === "signed" ? <>
                  <Button size="sm" variant="outline" onClick={() => void openFile(`${base}/${item.id}/sealed`).catch((e) => setError(e.message))}><FileDown className="h-3.5 w-3.5" />Signed PDF</Button>
                  <Button size="sm" variant="outline" disabled={busy !== null}
                    onClick={() => void run(item.id, async () => { const r = await api<{ intact: boolean; checkedAt: string }>(`${base}/${item.id}/verify`); setVerified((v) => ({ ...v, [item.id]: r })); })}>
                    <ShieldCheck className="h-3.5 w-3.5" />Verify integrity
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void openFile(`${base}/${item.id}/evidence-packet`, `Form-${item.form_type}-${item.tax_year}-evidence.json`).catch((e) => setError(e.message))}><FileJson className="h-3.5 w-3.5" />Evidence packet</Button>
                </> : null}
                {item.status !== "voided" ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setReasonFor({ item, action: "void" })}>Void</Button> : null}
              </div>

              {verified[item.id] ? (
                <p className={`mt-2 rounded px-2 py-1 text-xs ${verified[item.id].intact ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>
                  {verified[item.id].intact ? "Intact: sealed file matches its recorded SHA-256" : "Altered or missing: sealed file does not match its recorded SHA-256"} · checked {formatDateTime(verified[item.id].checkedAt)}
                </p>
              ) : null}

              {reasonFor?.item.id === item.id ? (
                <ReasonForm label={reasonFor.action === "void" ? "Reason for voiding" : "What is wrong with the copy?"} busy={busy !== null}
                  onCancel={() => setReasonFor(null)}
                  onSubmit={(reason) => void run(item.id, async () => {
                    await api(`${base}/${item.id}/${reasonFor.action === "void" ? "void" : "handwritten/reject"}`, { method: "POST", body: JSON.stringify({ reason }) });
                    setReasonFor(null);
                  }, reasonFor.action === "void" ? "Authorization voided." : "Copy rejected. Send a new pen-sign link.")} />
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>

      {uploading ? <UploadSignedModal base={base} item={uploading} onClose={() => setUploading(null)} onDone={() => { setUploading(null); setNotice("Signed copy sealed."); void load(); }} /> : null}
      {inPerson ? <InPersonModal base={base} item={inPerson} onClose={() => setInPerson(null)} onDone={() => { setInPerson(null); setNotice("Signed in office and sealed."); void load(); }} /> : null}
    </Card>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone: "amber" | "sky" | "emerald" | "neutral"; hint?: string }) {
  const color = { amber: "text-amber-600 dark:text-amber-400", sky: "text-sky-600 dark:text-sky-400", emerald: "text-emerald-600 dark:text-emerald-400", neutral: "text-[var(--color-foreground)]" }[tone];
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3">
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
      {hint ? <div className="text-[11px] text-[var(--color-muted-foreground)]">{hint}</div> : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[var(--color-muted-foreground)]">{label}</dt><dd className="font-medium">{value}</dd></div>;
}

const inputClass = "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]";

function ReasonForm({ label, busy, onCancel, onSubmit }: { label: string; busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onSubmit(reason.trim()); }}>
      <label className="min-w-[220px] flex-1 text-xs">{label}<input autoFocus className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button size="sm" type="submit" disabled={busy || !reason.trim()}>Confirm</Button>
      <Button size="sm" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
    </form>
  );
}

function PrepareForm({ clientId, base, defaultTaxYear, onDone }: { clientId: string; base: string; defaultTaxYear: number; onDone: () => void }) {
  const [returns, setReturns] = useState<TaxReturn[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<{ returns: TaxReturn[] }>(`/api/clients/${clientId}/returns`).then((r) => setReturns(r.returns ?? [])).catch(() => setReturns([])); }, [clientId]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(null);
    try { await api(base, { method: "POST", body: new FormData(e.currentTarget) }); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare the authorization."); }
    finally { setSaving(false); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-4 sm:grid-cols-3">
      <label className="text-xs">Form<select name="formType" className={inputClass} defaultValue="8879"><option value="8879">8879 (return)</option><option value="8878">8878 (extension)</option></select></label>
      <label className="text-xs">Tax year<input name="taxYear" type="number" className={inputClass} defaultValue={defaultTaxYear} required /></label>
      <label className="text-xs">Return<select name="taxReturnId" className={inputClass} defaultValue=""><option value="">Not linked</option>{returns.filter((r) => r.status === "draft" || r.status === "rejected").map((r) => <option key={r.id} value={r.id}>{r.form_type} {r.tax_year} ({r.status})</option>)}</select></label>
      <label className="text-xs">Taxpayer name<input name="taxpayerName" className={inputClass} required /></label>
      <label className="text-xs">Taxpayer email<input name="taxpayerEmail" type="email" className={inputClass} placeholder="Needed for pen-sign links" /></label>
      <label className="text-xs">Signer<select name="taxpayerRole" className={inputClass} defaultValue="primary"><option value="primary">Taxpayer</option><option value="spouse">Spouse</option></select></label>
      <label className="text-xs">Spouse name (joint return)<input name="spouseName" className={inputClass} placeholder="Leave blank if not joint" /></label>
      <label className="text-xs">Spouse email<input name="spouseEmail" type="email" className={inputClass} /></label>
      <label className="text-xs sm:col-span-2">Prepared form PDF from your tax software<input name="file" type="file" accept="application/pdf" required className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-muted)] file:px-3 file:py-1.5" /></label>
      <div className="flex items-end"><Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Prepare"}</Button></div>
      {error ? <p role="alert" className="text-sm text-rose-600 sm:col-span-3">{error}</p> : null}
    </form>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">{title}</h2><Button size="icon" variant="ghost" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button></div>
        {children}
      </div>
    </div>
  );
}

function UploadSignedModal({ base, item, onClose, onDone }: { base: string; item: Authorization; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(null);
    const form = new FormData(e.currentTarget);
    form.set("attestSignedAndDated", form.get("attest") === "on" ? "true" : "false");
    try { await api(`${base}/${item.id}/handwritten`, { method: "POST", body: form }); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed."); }
    finally { setSaving(false); }
  }
  return (
    <Modal title={`Upload signed Form ${item.form_type}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3 text-sm">
        <p className="text-[var(--color-muted-foreground)]">For a form the taxpayer signed by hand and returned by fax, email or mail. No ID check is required for handwritten signatures.</p>
        <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-muted)] file:px-3 file:py-1.5" />
        <label className="flex items-start gap-2"><input name="attest" type="checkbox" required className="mt-1" />I checked this copy: {item.taxpayer_name} signed and dated it.</label>
        {error ? <p role="alert" className="text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Sealing…" : "Seal signed copy"}</Button></div>
      </form>
    </Modal>
  );
}

function InPersonModal({ base, item, onClose, onDone }: { base: string; item: Authorization; onClose: () => void; onDone: () => void }) {
  const [returning, setReturning] = useState<{ priorTaxYear: number } | null>(null);
  const [mode, setMode] = useState<"photo_id" | "multi_year">("photo_id");
  const [present, setPresent] = useState(false);
  const [signMode, setSignMode] = useState<"drawn" | "typed">("drawn");
  const [signerName, setSignerName] = useState(item.taxpayer_name);
  const [pin, setPin] = useState("");
  const [id, setId] = useState({ idType: "drivers_license", idNumberLast4: "", legalName: item.taxpayer_name, ssnLast4: "", address: "", dateOfBirth: "", photoMatchesTaxpayer: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<SignaturePadHandle>(null);

  useEffect(() => { void api<{ relationship: { priorTaxYear: number } | null }>(`${base}/${item.id}/multi-year`).then((r) => setReturning(r.relationship)).catch(() => setReturning(null)); }, [base, item.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const signatureData = signMode === "drawn" ? pad.current?.toDataUrl() : signerName.trim();
    if (!signatureData) { setError("The taxpayer needs to sign on the pad."); return; }
    setSaving(true);
    try {
      await api(`${base}/${item.id}/sign-in-person`, { method: "POST", body: JSON.stringify({
        signature: { signatureType: signMode, signatureData, signerName, taxpayerPin: pin },
        identity: mode === "multi_year" ? { mode } : { mode, inspection: id },
      }) });
      onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Signing failed."); }
    finally { setSaving(false); }
  }
  const set = (key: keyof typeof id) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setId((v) => ({ ...v, [key]: e.target.value }));

  return (
    <Modal title={`Sign Form ${item.form_type} in office`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4 text-sm">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">1. Identity</legend>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === "photo_id" ? "default" : "outline"} onClick={() => setMode("photo_id")}>Inspect photo ID</Button>
            <Button type="button" size="sm" variant={mode === "multi_year" ? "default" : "outline"} disabled={!returning} onClick={() => setMode("multi_year")}
              title={returning ? undefined : "Needs a prior-year signing with a verified ID"}>Returning client{returning ? ` (${returning.priorTaxYear})` : ""}</Button>
          </div>
          {mode === "photo_id" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs">ID type<select className={inputClass} value={id.idType} onChange={set("idType")}>
                <option value="drivers_license">Driver's license</option><option value="state_id">State ID</option><option value="passport">Passport</option>
                <option value="military_id">Military ID</option><option value="other_government_id">Other government ID</option></select></label>
              <label className="text-xs">ID number, last 4<input className={inputClass} maxLength={4} value={id.idNumberLast4} onChange={set("idNumberLast4")} required /></label>
              <label className="text-xs">Name on ID<input className={inputClass} value={id.legalName} onChange={set("legalName")} required /></label>
              <label className="text-xs">SSN or ITIN, last 4<input className={inputClass} inputMode="numeric" maxLength={4} value={id.ssnLast4} onChange={set("ssnLast4")} required /></label>
              <label className="text-xs">Date of birth<input type="date" className={inputClass} value={id.dateOfBirth} onChange={set("dateOfBirth")} required /></label>
              <label className="text-xs">Address<input className={inputClass} value={id.address} onChange={set("address")} required /></label>
              <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={id.photoMatchesTaxpayer} onChange={(e) => setId((v) => ({ ...v, photoMatchesTaxpayer: e.target.checked }))} required />The photo matches the person in front of me.</label>
            </div>
          ) : <p className="text-xs text-[var(--color-muted-foreground)]">ID was verified when this taxpayer signed for {returning?.priorTaxYear}. Publication 1345 lets you skip the ID check.</p>}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">2. Taxpayer signs</legend>
          <label className="block text-xs">Legal name<input className={inputClass} value={signerName} onChange={(e) => setSignerName(e.target.value)} required /></label>
          <label className="block text-xs">Five-digit PIN the taxpayer chooses as their signature<input className={`${inputClass} font-mono tracking-[0.4em]`} inputMode="numeric" maxLength={5} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required /></label>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={signMode === "drawn" ? "default" : "outline"} onClick={() => setSignMode("drawn")}>Draw</Button>
            <Button type="button" size="sm" variant={signMode === "typed" ? "default" : "outline"} onClick={() => setSignMode("typed")}>Type</Button>
          </div>
          {signMode === "drawn" ? <SignaturePad ref={pad} /> : <p className="rounded-md border border-[var(--color-border)] bg-white px-3 py-4 text-center font-serif text-2xl italic text-[#0f2347]">{signerName}</p>}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={present} onChange={(e) => setPresent(e.target.checked)} required />The taxpayer is here with me and is signing this themselves.</label>
        </fieldset>

        {error ? <p role="alert" className="text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving || !present}>{saving ? "Sealing…" : "Sign and seal"}</Button></div>
      </form>
    </Modal>
  );
}

type SignaturePadHandle = { toDataUrl: () => string | null };

const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = el.offsetWidth * ratio; el.height = el.offsetHeight * ratio;
    const ctx = el.getContext("2d")!; ctx.scale(ratio, ratio);
    ctx.strokeStyle = "#0f2347"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
  }, []);
  useImperativeHandle(ref, () => ({ toDataUrl: () => (empty || !canvas.current ? null : canvas.current.toDataURL("image/png")) }), [empty]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div>
      <canvas ref={canvas} className="h-32 w-full touch-none rounded-md border border-[var(--color-border)] bg-white"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const ctx = e.currentTarget.getContext("2d")!; ctx.beginPath(); ctx.moveTo(...point(e)); drawing.current = true; }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = e.currentTarget.getContext("2d")!; ctx.lineTo(...point(e)); ctx.stroke(); setEmpty(false); }}
        onPointerUp={() => { drawing.current = false; }} />
      <div className="mt-1 flex justify-between text-[11px] text-[var(--color-muted-foreground)]">
        <span>Sign with a finger, stylus or mouse</span>
        <button type="button" className="hover:opacity-80" onClick={() => { const el = canvas.current; if (!el) return; el.getContext("2d")!.clearRect(0, 0, el.width, el.height); setEmpty(true); }}>Clear</button>
      </div>
    </div>
  );
});
