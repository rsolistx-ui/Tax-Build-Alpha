import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** One-time acceptance of the Truepost service agreement; a new version asks again. */
export function AgreementGate({ onAccepted }: { onAccepted: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void api<{ text: string }>("/api/agreement").then((r) => setText(r.text)).catch((e: Error) => setError(e.message)); }, []);

  async function accept(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/api/agreement/accept", { method: "POST", body: JSON.stringify({ agreed, typedName: name }) }); onAccepted(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record acceptance."); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <section className="w-full max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2"><FileText className="h-5 w-5 text-[var(--color-primary)]" /><h1 className="text-lg font-semibold">Truepost service agreement</h1></div>
        <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">It sets out how client information is protected and what stays your professional responsibility. Please read it before continuing.</p>
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-sm leading-relaxed">{text ?? "Loading…"}</div>
        <form onSubmit={(e) => void accept(e)} className="mt-4 space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I have read this agreement and accept it for my firm.</label>
          <label className="block">Type your full name<input className="mt-1 h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
          {error ? <p role="alert" className="text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>Print</Button>
            <Button type="submit" disabled={busy || !agreed || name.trim().length < 2 || !text}>{busy ? "Saving…" : "Accept and continue"}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
