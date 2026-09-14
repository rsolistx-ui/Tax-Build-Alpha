import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CarryforwardPanel({ clientId }: { clientId: string }) {
  const [cfs, setCfs] = useState<any[]>([]);
  useEffect(() => { api<{ carryforwards: any[] }>(`/api/clients/${clientId}/carryforwards`).then(d => setCfs(d.carryforwards)).catch(() => {}); }, [clientId]);
  return <Card><CardHeader><CardTitle>Carryforwards</CardTitle></CardHeader><CardContent>{cfs.length === 0 ? <p className="text-sm text-muted-foreground">No carryforwards</p> : cfs.map((c: any) => <div key={c.id} className="text-sm border-b py-2">{c.carryforward_type} {c.tax_year_generated} — {c.remaining_amount} remaining</div>)}</CardContent></Card>;
}

export function StateModsPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [mods, setMods] = useState<any[]>([]);
  useEffect(() => { api<{ mods: any[] }>(`/api/clients/${clientId}/state-mods/${taxYear}`).then(d => setMods(d.mods)).catch(() => {}); }, [clientId, taxYear]);
  return <Card><CardHeader><CardTitle>State Modifications — {taxYear}</CardTitle></CardHeader><CardContent>{mods.length === 0 ? <p className="text-sm text-muted-foreground">No state mods</p> : mods.map((m: any) => <div key={m.id} className="text-sm border-b py-2">{m.state} {m.modification_type}: {m.amount}</div>)}</CardContent></Card>;
}

export function M3Panel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api<any>(`/api/clients/${clientId}/m3/${taxYear}`).then(setData).catch(() => {}); }, [clientId, taxYear]);
  if (!data?.reconciliation) return <Card><CardHeader><CardTitle>M-3 — {taxYear}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">No M-3 reconciliation</p></CardContent></Card>;
  return <Card><CardHeader><CardTitle>M-3 — {taxYear}</CardTitle></CardHeader><CardContent>{data.lines.map((l: any) => <div key={l.id} className="text-sm border-b py-2">{l.part} {l.line_code}: {l.per_books} + {l.temporary_diff} + {l.permanent_diff} = {l.per_return}</div>)}</CardContent></Card>;
}

export function PriorYearPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api<any>(`/api/clients/${clientId}/prior-year-compare/${taxYear}`).then(setData).catch(() => {}); }, [clientId, taxYear]);
  if (!data) return null;
  return <Card><CardHeader><CardTitle>Prior Year Compare — {data.priorYear} vs {data.taxYear}</CardTitle></CardHeader><CardContent><p className="text-sm">Added: {data.added.length} Removed: {data.removed.length}</p></CardContent></Card>;
}

export function ExtensionsPanel({ clientId }: { clientId: string }) {
  const [exts, setExts] = useState<any[]>([]);
  useEffect(() => { api<{ extensions: any[] }>(`/api/clients/${clientId}/extensions`).then(d => setExts(d.extensions)).catch(() => {}); }, [clientId]);
  return <Card><CardHeader><CardTitle>Extensions</CardTitle></CardHeader><CardContent>{exts.length === 0 ? <p className="text-sm text-muted-foreground">No extensions</p> : exts.map((e: any) => <div key={e.id} className="text-sm border-b py-2">{e.form_type} {e.tax_year} — {e.status}</div>)}</CardContent></Card>;
}

export function OrganizerPanel({ clientId, taxForm }: { clientId: string; taxForm: string }) {
  const [checklist, setChecklist] = useState<any[]>([]);
  useEffect(() => { api<{ checklist: any[] }>(`/api/clients/${clientId}/tax-organizer/${taxForm}`).then(d => setChecklist(d.checklist)).catch(() => {}); }, [clientId, taxForm]);
  return <Card><CardHeader><CardTitle>Organizer — {taxForm}</CardTitle></CardHeader><CardContent>{checklist.map((c: any) => <div key={c.code} className="text-sm border-b py-2">{c.label} {c.required ? "(required)" : ""}</div>)}</CardContent></Card>;
}

export function DiagnosticsPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [diags, setDiags] = useState<any[]>([]);
  useEffect(() => { api<{ diagnostics: any[] }>(`/api/clients/${clientId}/tax-diagnostics/${taxYear}`).then(d => setDiags(d.diagnostics)).catch(() => {}); }, [clientId, taxYear]);
  return <Card><CardHeader><CardTitle>Diagnostics — {taxYear}</CardTitle></CardHeader><CardContent>{diags.length === 0 ? <p className="text-sm text-emerald-600">No issues</p> : diags.map((d: any, i: number) => <div key={i} className={`text-sm border-b py-2 ${d.severity === "error" ? "text-red-600" : "text-amber-600"}`}>{d.code}: {d.message}</div>)}</CardContent></Card>;
}
