import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function CarryforwardPanel({ clientId }: { clientId: string }) {
  const [cfs, setCfs] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ carryforwardType: "nol", state: "", taxYearGenerated: new Date().getFullYear().toString(), taxYearExpires: "", originalAmount: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [utilizeId, setUtilizeId] = useState("");
  const [utilizeAmount, setUtilizeAmount] = useState("");
  const [utilizeYear, setUtilizeYear] = useState("");

  const load = useCallback(() => {
    api<{ carryforwards: any[] }>(`/api/clients/${clientId}/carryforwards`).then((d) => setCfs(d.carryforwards)).catch(() => {});
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/carryforwards`, {
        method: "POST",
        body: JSON.stringify({
          carryforwardType: form.carryforwardType,
          state: form.state || undefined,
          taxYearGenerated: Number(form.taxYearGenerated),
          taxYearExpires: form.taxYearExpires ? Number(form.taxYearExpires) : undefined,
          originalAmount: Number(form.originalAmount),
          notes: form.notes || undefined,
        }),
      });
      setShowForm(false);
      setForm({ carryforwardType: "nol", state: "", taxYearGenerated: String(new Date().getFullYear()), taxYearExpires: "", originalAmount: "", notes: "" });
      load();
    } finally { setSaving(false); }
  }

  async function handleUtilize(cfId: string) {
    const amount = Number(utilizeAmount);
    const year = Number(utilizeYear);
    if (!amount || !year) return;
    await api(`/api/clients/${clientId}/carryforwards/${cfId}/utilize`, {
      method: "POST",
      body: JSON.stringify({ taxYearUsed: year, amountUsed: amount, returnType: "1040" }),
    });
    setUtilizeId(""); setUtilizeAmount(""); setUtilizeYear("");
    load();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Carryforwards</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New"}</Button>
        </div>
        {cfs.some((c) => c.tax_year_expires && c.status === "active") && <CardDescription className="text-xs text-amber-600">Some carryforwards have expiry — review before posting.</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
            <select value={form.carryforwardType} onChange={(e) => setForm((f) => ({ ...f, carryforwardType: e.target.value }))} className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm">
              <option value="nol">NOL</option>
              <option value="capital_loss">Capital loss</option>
              <option value="credit">Credit</option>
              <option value="passive_loss">Passive loss</option>
            </select>
            <Input placeholder="State (optional, e.g. CA)" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
            <Input placeholder="Year generated" value={form.taxYearGenerated} onChange={(e) => setForm((f) => ({ ...f, taxYearGenerated: e.target.value }))} />
            <Input placeholder="Year expires (optional)" value={form.taxYearExpires} onChange={(e) => setForm((f) => ({ ...f, taxYearExpires: e.target.value }))} />
            <Input placeholder="Original amount" value={form.originalAmount} onChange={(e) => setForm((f) => ({ ...f, originalAmount: e.target.value }))} />
            <Input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="col-span-2"><Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "Create"}</Button></div>
          </form>
        )}
        {cfs.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No carryforwards yet.</p> : cfs.map((c: any) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
            <Badge className={c.status === "fully_used" ? "bg-stone-200 text-stone-500" : c.tax_year_expires ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>{c.status}</Badge>
            <span className="font-medium">{c.carryforward_type}</span>
            <span className="text-[var(--color-muted-foreground)]">gen {c.tax_year_generated}{c.tax_year_expires ? ` · expires ${c.tax_year_expires}` : ""}</span>
            <span className="ml-auto font-mono">${Number(c.remaining_amount).toLocaleString()} / ${Number(c.original_amount).toLocaleString()}</span>
            {c.status === "active" && (
              <div className="flex w-full items-center gap-1 pt-1">
                {utilizeId === c.id ? (
                  <>
                    <Input className="h-7 w-20 text-xs" placeholder="Year used" value={utilizeYear} onChange={(e) => setUtilizeYear(e.target.value)} />
                    <Input className="h-7 w-24 text-xs" placeholder="Amount" value={utilizeAmount} onChange={(e) => setUtilizeAmount(e.target.value)} />
                    <Button size="sm" onClick={() => void handleUtilize(c.id)}>Apply</Button>
                    <Button size="sm" variant="ghost" onClick={() => setUtilizeId("")}>Cancel</Button>
                  </>
                ) : <Button size="sm" variant="ghost" onClick={() => setUtilizeId(c.id)}>Utilize</Button>}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function StateModsPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [mods, setMods] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ state: "", modificationType: "addition", description: "", amount: "", federalLineCode: "", stateLineCode: "", apportionmentFactor: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<{ mods: any[] }>(`/api/clients/${clientId}/state-mods/${taxYear}`).then((d) => setMods(d.mods)).catch(() => {});
  }, [clientId, taxYear]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/state-mods`, {
        method: "POST",
        body: JSON.stringify({
          state: form.state.toUpperCase(),
          taxYear: Number(taxYear),
          modificationType: form.modificationType,
          description: form.description,
          amount: Number(form.amount),
          federalLineCode: form.federalLineCode || undefined,
          stateLineCode: form.stateLineCode || undefined,
          apportionmentFactor: form.apportionmentFactor ? Number(form.apportionmentFactor) : undefined,
        }),
      });
      setShowForm(false);
      setForm({ state: "", modificationType: "addition", description: "", amount: "", federalLineCode: "", stateLineCode: "", apportionmentFactor: "" });
      load();
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">State Modifications — {taxYear}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
            <Input placeholder="State code (CA, NY...)" maxLength={2} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
            <select value={form.modificationType} onChange={(e) => setForm((f) => ({ ...f, modificationType: e.target.value }))} className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm">
              <option value="addition">Addition</option>
              <option value="subtraction">Subtraction</option>
              <option value="apportionment">Apportionment</option>
            </select>
            <Input className="col-span-2" placeholder="Description (e.g. CA conformity adjustment)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            <Input placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            <Input placeholder="Fed line code (optional)" value={form.federalLineCode} onChange={(e) => setForm((f) => ({ ...f, federalLineCode: e.target.value }))} />
            <Input placeholder="State line code (optional)" value={form.stateLineCode} onChange={(e) => setForm((f) => ({ ...f, stateLineCode: e.target.value }))} />
            <Input placeholder="Apportionment factor 0-1 (optional)" value={form.apportionmentFactor} onChange={(e) => setForm((f) => ({ ...f, apportionmentFactor: e.target.value }))} />
            <div className="col-span-2"><Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "Create"}</Button></div>
          </form>
        )}
        {mods.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No state modifications for {taxYear}.</p> : mods.map((m: any) => (
          <div key={m.id} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
            <Badge>{m.state}</Badge>
            <span>{m.modification_type}: {m.description}</span>
            <span className="ml-auto font-mono font-medium">${Number(m.amount).toLocaleString()}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function M3Panel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [data, setData] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ part: "II" as "I" | "II" | "III", lineCode: "", lineLabel: "", lineCategory: "income", perBooks: "", temporaryDiff: "0", permanentDiff: "0", otherDiff: "0" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<any>(`/api/clients/${clientId}/m3/${taxYear}`).then(setData).catch(() => {});
  }, [clientId, taxYear]);
  useEffect(() => { load(); }, [load]);

  async function ensureRecon() {
    if (data?.reconciliation) return data.reconciliation.id as string;
    const res = await api<{ reconciliation: { id: string } }>(`/api/clients/${clientId}/m3`, { method: "POST", body: JSON.stringify({ taxYear }) });
    return res.reconciliation.id;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const reconId = await ensureRecon();
      await api(`/api/clients/${clientId}/m3/${reconId}/lines`, {
        method: "POST",
        body: JSON.stringify({
          part: form.part, lineCode: form.lineCode, lineLabel: form.lineLabel, lineCategory: form.lineCategory,
          perBooks: Number(form.perBooks), temporaryDiff: Number(form.temporaryDiff),
          permanentDiff: Number(form.permanentDiff), otherDiff: Number(form.otherDiff),
        }),
      });
      setShowForm(false);
      setForm({ part: "II", lineCode: "", lineLabel: "", lineCategory: "income", perBooks: "", temporaryDiff: "0", permanentDiff: "0", otherDiff: "0" });
      load();
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">M-3 — {taxYear}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add line"}</Button>
        </div>
        {data?.reconciliation && <CardDescription className="text-xs">Status: {data.reconciliation.status} · per_return is auto-generated (per_books + all diffs)</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <form onSubmit={handleAdd} className="grid grid-cols-2 gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
            <select value={form.part} onChange={(e) => setForm((f) => ({ ...f, part: e.target.value as any }))} className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm">
              <option value="I">Part I</option><option value="II">Part II</option><option value="III">Part III</option>
            </select>
            <Input placeholder="Line code (e.g. 28)" value={form.lineCode} onChange={(e) => setForm((f) => ({ ...f, lineCode: e.target.value }))} />
            <Input className="col-span-2" placeholder="Line label" value={form.lineLabel} onChange={(e) => setForm((f) => ({ ...f, lineLabel: e.target.value }))} />
            <Input placeholder="Category" value={form.lineCategory} onChange={(e) => setForm((f) => ({ ...f, lineCategory: e.target.value }))} />
            <Input placeholder="Per books" value={form.perBooks} onChange={(e) => setForm((f) => ({ ...f, perBooks: e.target.value }))} />
            <Input placeholder="Temporary diff" value={form.temporaryDiff} onChange={(e) => setForm((f) => ({ ...f, temporaryDiff: e.target.value }))} />
            <Input placeholder="Permanent diff" value={form.permanentDiff} onChange={(e) => setForm((f) => ({ ...f, permanentDiff: e.target.value }))} />
            <Input placeholder="Other diff" value={form.otherDiff} onChange={(e) => setForm((f) => ({ ...f, otherDiff: e.target.value }))} />
            <div className="col-span-2"><Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "Add"}</Button></div>
          </form>
        )}
        {!data?.reconciliation ? <p className="text-sm text-[var(--color-muted-foreground)]">No M-3 reconciliation for {taxYear}. Add a line to create one.</p> : data.lines.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No lines yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[var(--color-muted-foreground)] border-b"><th className="pb-1">Part</th><th className="pb-1">Line</th><th className="pb-1">Label</th><th className="pb-1 text-right">Per books</th><th className="pb-1 text-right">Per return</th></tr></thead>
              <tbody>{data.lines.map((l: any) => <tr key={l.id} className="border-b last:border-0"><td className="py-1">{l.part}</td><td className="py-1 font-mono">{l.line_code}</td><td className="py-1">{l.line_label}</td><td className="py-1 text-right font-mono">{Number(l.per_books).toLocaleString()}</td><td className="py-1 text-right font-mono font-medium">{Number(l.per_return).toLocaleString()}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PriorYearPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api<any>(`/api/clients/${clientId}/prior-year-compare/${taxYear}`).then(setData).catch(() => {}); }, [clientId, taxYear]);
  if (!data) return <Card><CardHeader><CardTitle className="text-sm">Prior Year Compare</CardTitle></CardHeader><CardContent><p className="text-sm text-[var(--color-muted-foreground)]">Loading...</p></CardContent></Card>;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Prior Year Compare — {data.priorYear} vs {data.taxYear}</CardTitle><CardDescription className="text-xs">{data.priorCount} lines in {data.priorYear} · {data.currentCount} lines in {data.taxYear}</CardDescription></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        <div><div className="text-xs font-medium text-emerald-700">Added ({data.added.length})</div>{data.added.length === 0 ? <p className="text-xs text-[var(--color-muted-foreground)]">None</p> : data.added.map((a: any) => <div key={a.form_line_code} className="text-xs border-b py-1">{a.form_line_code} {a.form_line_label}</div>)}</div>
        <div><div className="text-xs font-medium text-red-700">Removed ({data.removed.length})</div>{data.removed.length === 0 ? <p className="text-xs text-[var(--color-muted-foreground)]">None</p> : data.removed.map((a: any) => <div key={a.form_line_code} className="text-xs border-b py-1">{a.form_line_code} {a.form_line_label}</div>)}</div>
      </CardContent>
    </Card>
  );
}

export function ExtensionsPanel({ clientId }: { clientId: string }) {
  const [exts, setExts] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ taxYear: String(new Date().getFullYear()), formType: "4868", dueDate: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<{ extensions: any[] }>(`/api/clients/${clientId}/extensions`).then((d) => setExts(d.extensions)).catch(() => {});
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/extensions`, { method: "POST", body: JSON.stringify({ taxYear: Number(form.taxYear), formType: form.formType, dueDate: form.dueDate }) });
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Extensions</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <form onSubmit={handleCreate} className="grid grid-cols-3 gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
            <Input placeholder="Tax year" value={form.taxYear} onChange={(e) => setForm((f) => ({ ...f, taxYear: e.target.value }))} />
            <select value={form.formType} onChange={(e) => setForm((f) => ({ ...f, formType: e.target.value }))} className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm">
              <option value="4868">4868</option><option value="7004">7004</option>
            </select>
            <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
            <div className="col-span-3"><Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "File extension"}</Button></div>
          </form>
        )}
        {exts.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No extensions filed.</p> : exts.map((e: any) => (
          <div key={e.id} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
            <Badge className={e.status === "filed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{e.status}</Badge>
            <span>Form {e.form_type} · {e.tax_year}</span>
            <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">due {e.due_date}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function OrganizerPanel({ clientId, taxForm }: { clientId: string; taxForm: string }) {
  const [checklist, setChecklist] = useState<any[]>([]);
  const [prefillEnabled, setPrefillEnabled] = useState(false);
  useEffect(() => {
    const url = prefillEnabled ? `/api/clients/${clientId}/tax-organizer/${taxForm}?prefill=1` : `/api/clients/${clientId}/tax-organizer/${taxForm}`;
    api<{ checklist: any[] }>(url).then((d) => setChecklist(d.checklist)).catch(() => {});
  }, [clientId, taxForm, prefillEnabled]);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Organizer — {taxForm}</CardTitle>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={prefillEnabled} onChange={(e) => setPrefillEnabled(e.target.checked)} /> Prefill from prior year</label>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {checklist.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No organizer items.</p> : checklist.map((c: any) => (
          <div key={c.code} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
            <span>{c.label}</span>
            {c.required ? <Badge className="bg-red-100 text-red-800">required</Badge> : null}
            {c.prefilled ? <Badge className="bg-blue-100 text-blue-800">from prior year</Badge> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DiagnosticsPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [diags, setDiags] = useState<any[]>([]);
  useEffect(() => { api<{ diagnostics: any[] }>(`/api/clients/${clientId}/tax-diagnostics/${taxYear}`).then((d) => setDiags(d.diagnostics)).catch(() => {}); }, [clientId, taxYear]);
  const hasError = diags.some((d: any) => d.severity === "error");
  return (
    <Card className={hasError ? "border-red-300" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Diagnostics — {taxYear}</CardTitle>
          {hasError ? <Badge className="bg-red-100 text-red-800">{diags.filter((d: any) => d.severity === "error").length} error(s) blocking finalize</Badge> : <Badge className="bg-emerald-100 text-emerald-800">All clear</Badge>}
        </div>
        {hasError && <CardDescription className="text-xs text-red-600">Resolve errors before Tax Workbench can enter ready_for_preparation.</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-1">
        {diags.length === 0 ? <p className="text-sm text-emerald-600">No issues. This workpaper can be marked ready.</p> : diags.map((d: any, i: number) => (
          <div key={i} className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${d.severity === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            <span className="font-mono text-xs">{d.code}</span>
            <span className="flex-1">{d.message}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
