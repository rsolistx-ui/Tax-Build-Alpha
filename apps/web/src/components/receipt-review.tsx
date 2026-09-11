import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, ExternalLink, FileText, Plus, Save, Trash2 } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type ReviewCategory = { id: string; name: string; slug: string };

export type ReviewLineItem = {
  id?: string;
  lineNo?: number;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  category: string | null;
  confidence: number;
};

export type ValidationCheck = {
  code: string;
  label: string;
  status: "pass" | "warning" | "fail" | "skipped";
  message: string;
  expected?: number | null;
  actual?: number | null;
  difference?: number | null;
};

export type ReviewReceipt = {
  id: string;
  filename: string;
  content_type: string | null;
  status: string;
  extracted_date: string | null;
  extracted_merchant: string | null;
  extracted_subtotal: number | null;
  extracted_tax: number | null;
  extracted_tip: number | null;
  extracted_total: number | null;
  extracted_currency: string | null;
  extracted_category: string | null;
  remembered_category?: string | null;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  validation_status: "pending" | "pass" | "warning" | "fail";
  validation_json: { checks?: ValidationCheck[] } | null;
  lineItems: ReviewLineItem[];
  source_url: string;
};

type Draft = {
  date: string | null;
  merchant: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  currency: string;
  category: string | null;
  confidence: number;
  lineItems: ReviewLineItem[];
};

type SaveResponse = { receipt: ReviewReceipt };

export function ReceiptReview({
  clientId,
  categories,
  receipts,
  onReload,
  initialSelectedId,
}: {
  clientId: string;
  categories: ReviewCategory[];
  receipts: ReviewReceipt[];
  onReload: () => Promise<void>;
  initialSelectedId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState(
    (initialSelectedId && receipts.some((r) => r.id === initialSelectedId) ? initialSelectedId : receipts[0]?.id) ?? "",
  );
  const selected = useMemo(
    () => receipts.find((receipt) => receipt.id === selectedId) ?? receipts[0],
    [receipts, selectedId],
  );
  const baseline = useMemo(() => selected ? toDraft(selected) : null, [selected]);
  const [draft, setDraft] = useState<Draft | null>(baseline);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = useMemo(
    () => Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline)),
    [draft, baseline],
  );

  useEffect(() => {
    if (!selected && receipts[0]) setSelectedId(receipts[0].id);
  }, [selected, receipts]);

  useEffect(() => {
    setDraft(selected ? toDraft(selected) : null);
    setMessage(null);
  }, [selected?.id]);

  if (!selected || !draft) return null;

  const sourceUrl = apiUrl(selected.source_url);
  const checks = selected.validation_json?.checks ?? [];

  async function persistDraft(currentDraft: Draft): Promise<ReviewReceipt> {
    const result = await api<SaveResponse>(`/api/clients/${clientId}/receipts/${selected.id}`, {
      method: "PATCH",
      body: JSON.stringify(currentDraft),
    });
    return result.receipt;
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      await persistDraft(draft);
      setMessage("Review edits saved and validation rerun.");
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);

    try {
      // Approval always persists the visible draft first. This prevents a
      // reviewer from filing stale database values after editing the form.
      const saved = await persistDraft(draft);
      const needsOverride = saved.validation_status === "fail";
      const confirmOverride = needsOverride
        ? window.confirm("Validation is failing. File this receipt anyway after reviewing the source evidence?")
        : false;

      if (needsOverride && !confirmOverride) {
        setMessage("Edits were saved, but the receipt was not filed because validation is failing.");
        await onReload();
        return;
      }

      await api(`/api/clients/${clientId}/receipts/${selected.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ confirmOverride }),
      });
      setMessage("Receipt filed. Its approved evidence now feeds the P&L.");
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  function updateLine(index: number, patch: Partial<ReviewLineItem>) {
    setDraft((current) => current ? {
      ...current,
      lineItems: current.lineItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    } : current);
  }

  function addLine() {
    setDraft((current) => current ? {
      ...current,
      lineItems: [
        ...current.lineItems,
        { description: "", quantity: 1, unitPrice: null, amount: null, category: current.category, confidence: 1 },
      ],
    } : current);
  }

  function removeLine(index: number) {
    setDraft((current) => current ? {
      ...current,
      lineItems: current.lineItems.filter((_, itemIndex) => itemIndex !== index),
    } : current);
  }

  return (
    <div className="grid min-h-[680px] gap-3 xl:grid-cols-[220px_minmax(0,1fr)_440px]">
      <aside className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)]">
        <div className="border-b border-[var(--color-border)] px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">Review queue</p>
          <p className="mt-1 text-sm">{receipts.length} receipt{receipts.length === 1 ? "" : "s"}</p>
        </div>
        <div className="max-h-[620px] overflow-y-auto p-2">
          {receipts.map((receipt) => (
            <button
              key={receipt.id}
              type="button"
              onClick={() => setSelectedId(receipt.id)}
              className={`mb-1 w-full rounded-md px-2.5 py-2 text-left text-sm ${selected.id === receipt.id ? "bg-[var(--color-muted)]" : "hover:bg-[var(--color-muted)]/70"}`}
            >
              <div className="truncate font-medium">{receipt.extracted_merchant || receipt.filename}</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--color-muted-foreground)]">
                <span>{receipt.extracted_total != null ? `$${Number(receipt.extracted_total).toFixed(2)}` : "Total pending"}</span>
                <ValidationDot status={receipt.validation_status} />
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-stone-100">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{selected.filename}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">Original evidence from private R2 storage</p>
          </div>
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
            Open source <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex h-[620px] items-center justify-center overflow-auto p-3">
          {selected.content_type === "application/pdf" ? (
            <iframe title={selected.filename} src={sourceUrl} className="h-full w-full rounded-md bg-white" />
          ) : selected.content_type?.startsWith("image/") ? (
            <img src={sourceUrl} alt={selected.filename} className="max-h-full max-w-full rounded-md object-contain shadow-sm" />
          ) : (
            <div className="text-center text-sm text-[var(--color-muted-foreground)]">
              <FileText className="mx-auto mb-2 h-8 w-8" />
              Preview is not available for this file type. Use Open source.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 xl:max-h-[680px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Evidence review</p>
              {dirty ? <Badge className="bg-stone-200 text-stone-700">Unsaved edits</Badge> : null}
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              AI proposes. Validation checks the math. You decide what gets filed.
            </p>
          </div>
          <StatusBadge status={selected.validation_status} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          <Field label="Merchant" className="sm:col-span-2" value={draft.merchant ?? ""} onChange={(value) => setDraft({ ...draft, merchant: value || null })} />
          <Field label="Date" type="date" value={draft.date ?? ""} onChange={(value) => setDraft({ ...draft, date: value || null })} />
          <label className="space-y-1 text-xs font-medium">
            Category
            <select className={inputClass} value={draft.category ?? ""} onChange={(e) => setDraft({ ...draft, category: e.target.value || null })}>
              <option value="">Uncategorized</option>
              {categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}
            </select>
          </label>
          <MoneyField label="Subtotal" value={draft.subtotal} onChange={(value) => setDraft({ ...draft, subtotal: value })} />
          <MoneyField label="Tax" value={draft.tax} onChange={(value) => setDraft({ ...draft, tax: value })} />
          <MoneyField label="Tip" value={draft.tip} onChange={(value) => setDraft({ ...draft, tip: value })} />
          <MoneyField label="Total" value={draft.total} onChange={(value) => setDraft({ ...draft, total: value })} />
        </div>

        {selected.remembered_category && draft.category === selected.remembered_category ? (
          <div className="flex items-start gap-2 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-900" data-testid="remembered-category-note">
            <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Folio remembered {categories.find((c) => c.slug === selected.remembered_category)?.name ?? selected.remembered_category}
              {" "}for this merchant from a prior approved review. Change the category here and Folio will learn the correction.
            </span>
          </div>
        ) : null}

        <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Line items</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">These rows become the auditable expense ledger after approval.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={addLine}><Plus className="h-3.5 w-3.5" /> Add</Button>
          </div>
          <div className="space-y-2">
            {draft.lineItems.map((item, index) => (
              <Card key={item.id ?? `new-${index}`}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex gap-2">
                    <input
                      className={`${inputClass} flex-1`}
                      value={item.description}
                      placeholder="Item description"
                      onChange={(e) => updateLine(index, { description: e.target.value })}
                    />
                    <button type="button" className="rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]" onClick={() => removeLine(index)} aria-label="Remove line item">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumberInput value={item.quantity} placeholder="Qty" onChange={(value) => updateLine(index, { quantity: value })} />
                    <NumberInput value={item.unitPrice} placeholder="Unit" onChange={(value) => updateLine(index, { unitPrice: value })} />
                    <NumberInput value={item.amount} placeholder="Amount" onChange={(value) => updateLine(index, { amount: value })} />
                  </div>
                  <select className={inputClass} value={item.category ?? ""} onChange={(e) => updateLine(index, { category: e.target.value || null })}>
                    <option value="">Item category</option>
                    {categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}
                  </select>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Validation</p>
          {checks.length ? checks.map((check) => (
            <div key={check.code} className="flex gap-2 rounded-md bg-[var(--color-muted)]/50 p-2.5 text-xs">
              {check.status === "pass" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <div><span className="font-medium">{check.label}.</span> {check.message}</div>
            </div>
          )) : <p className="text-xs text-[var(--color-muted-foreground)]">Validation will run when the receipt is saved.</p>}
        </div>

        {message ? <p className="rounded-md bg-[var(--color-muted)] p-2.5 text-xs">{message}</p> : null}

        <div className="sticky bottom-0 flex gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)] pt-3">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => void save()}><Save className="h-4 w-4" /> Save review</Button>
          <Button className="flex-1" disabled={busy} onClick={() => void approve()}><CheckCircle2 className="h-4 w-4" /> Approve & file</Button>
        </div>
      </section>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-300";

function toDraft(receipt: ReviewReceipt): Draft {
  return {
    date: receipt.extracted_date,
    merchant: receipt.extracted_merchant,
    subtotal: receipt.extracted_subtotal,
    tax: receipt.extracted_tax,
    tip: receipt.extracted_tip,
    total: receipt.extracted_total,
    currency: receipt.extracted_currency || "USD",
    category: receipt.extracted_category,
    confidence: receipt.confidence ?? 1,
    lineItems: receipt.lineItems.map((item) => ({ ...item })),
  };
}

function Field({ label, value, onChange, type = "text", className = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; className?: string }) {
  return (
    <label className={`space-y-1 text-xs font-medium ${className}`}>
      {label}
      <input className={inputClass} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="space-y-1 text-xs font-medium">
      {label}
      <NumberInput value={value} onChange={onChange} />
    </label>
  );
}

function NumberInput({ value, onChange, placeholder }: { value: number | null; onChange: (value: number | null) => void; placeholder?: string }) {
  return <input className={inputClass} type="number" step="0.01" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
}

function StatusBadge({ status }: { status: ReviewReceipt["validation_status"] }) {
  const label = status === "pass" ? "Validated" : status === "warning" ? "Check" : status === "fail" ? "Mismatch" : "Pending";
  return <Badge className={status === "fail" ? "bg-red-100 text-red-800" : status === "warning" ? "bg-amber-100 text-amber-800" : status === "pass" ? "bg-emerald-100 text-emerald-800" : ""}>{label}</Badge>;
}

function ValidationDot({ status }: { status: ReviewReceipt["validation_status"] }) {
  return <span className={`h-2 w-2 rounded-full ${status === "fail" ? "bg-red-500" : status === "warning" ? "bg-amber-500" : status === "pass" ? "bg-emerald-500" : "bg-stone-400"}`} title={status} />;
}
