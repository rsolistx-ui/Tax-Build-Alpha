import { useEffect, useState } from "react";
import { CalendarClock, Car, Download, Home, Trash2 } from "lucide-react";
import { api, apiUrl } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/formatters";
import { canSeeSignedRecords, useFirmRole } from "@/lib/firm-role";

const inputClass = "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,]/g, "")));

type EstimateResult = { requiredAnnualPayment: number | null; basis: string; installments: Array<{ number: number; dueDate: string; amount: number }>; notes: string[] };

/** Quarterly estimated tax, IRC § 6654 safe harbor. The preparer supplies every figure. */
export function EstimatedTaxPanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [form, setForm] = useState({ taxYear: String(taxYear), priorYearTax: "", priorYearAgi: "", currentYearTax: "", expectedWithholding: "", priorYearQualifies: true, marriedFilingSeparately: false, farmerOrFisherman: false });
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importedSource, setImportedSource] = useState<string | null>(null);

  useEffect(() => {
    setImportedSource(null);
    void api<{ summary: { adjustedGrossIncome: number; totalTax: number; sourceFilename: string } | null }>(`/api/accounting-import/prior-year-tax-summary/${clientId}?taxYear=${taxYear - 1}`)
      .then(({ summary }) => {
        if (!summary) return;
        setForm((current) => ({ ...current, priorYearTax: current.priorYearTax || String(summary.totalTax), priorYearAgi: current.priorYearAgi || String(summary.adjustedGrossIncome) }));
        setImportedSource(summary.sourceFilename);
      })
      .catch(() => undefined);
  }, [clientId, taxYear]);

  async function compute(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      setResult(await api<EstimateResult>(`/api/clients/${clientId}/estimated-tax`, { method: "POST", body: JSON.stringify({
        taxYear: Number(form.taxYear), priorYearTax: num(form.priorYearTax), priorYearAgi: num(form.priorYearAgi), currentYearTax: num(form.currentYearTax),
        expectedWithholding: num(form.expectedWithholding) ?? 0, priorYearQualifies: form.priorYearQualifies,
        marriedFilingSeparately: form.marriedFilingSeparately, farmerOrFisherman: form.farmerOrFisherman,
      }) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not compute."); }
  }
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-[var(--color-primary)]" />Quarterly estimated tax</CardTitle>
        <CardDescription>Safe-harbor installments under IRC § 6654. Enter figures from the prior return and your projection.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void compute(e)} className="grid gap-3 sm:grid-cols-3">
          {importedSource ? <p className="sm:col-span-3 text-xs text-[var(--color-muted-foreground)]">Prior-year AGI and total tax were prefilled from {importedSource}. Review before calculating.</p> : null}
          <label className="text-xs">Tax year<input className={inputClass} inputMode="numeric" value={form.taxYear} onChange={set("taxYear")} /></label>
          <label className="text-xs">Prior-year total tax<input className={inputClass} inputMode="decimal" value={form.priorYearTax} onChange={set("priorYearTax")} placeholder="Form 1040, total tax" /></label>
          <label className="text-xs">Prior-year AGI<input className={inputClass} inputMode="decimal" value={form.priorYearAgi} onChange={set("priorYearAgi")} /></label>
          <label className="text-xs">Projected tax this year (optional)<input className={inputClass} inputMode="decimal" value={form.currentYearTax} onChange={set("currentYearTax")} /></label>
          <label className="text-xs">Expected withholding<input className={inputClass} inputMode="decimal" value={form.expectedWithholding} onChange={set("expectedWithholding")} /></label>
          <div className="space-y-1 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.priorYearQualifies} onChange={set("priorYearQualifies")} />Prior year was a full year with a return filed</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.marriedFilingSeparately} onChange={set("marriedFilingSeparately")} />Married filing separately</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.farmerOrFisherman} onChange={set("farmerOrFisherman")} />Farmer or fisherman</label>
          </div>
          <div className="sm:col-span-3"><Button type="submit">Calculate</Button></div>
        </form>
        {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
        {result ? (
          <div className="space-y-3">
            {result.requiredAnnualPayment == null ? <p className="text-sm text-[var(--color-muted-foreground)]">{result.basis}</p> : <>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-2xl font-semibold tabular-nums">{usd(result.requiredAnnualPayment)}</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">required annual payment · {result.basis}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {result.installments.map((i) => (
                  <div key={i.number} className="rounded-lg border border-[var(--color-border)] p-3">
                    <div className="text-xs text-[var(--color-muted-foreground)]">Due {formatDate(i.dueDate)}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{usd(i.amount)}</div>
                  </div>
                ))}
              </div>
            </>}
            {result.notes.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--color-muted-foreground)]">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Trip = { id: string; trip_date: string; origin: string | null; destination: string; business_purpose: string; miles: string; vehicle: string | null; parking_and_tolls: string };
type Summary = { trips: number; miles: number; mileageAmount: number; parkingAndTolls: number; total: number; rates: Array<{ cents: number; source: string; miles: number }>; unratedMiles: number };

/** Business mileage log with the IRS standard rate for each trip date (IRC § 274(d)). */
export function MileagePanel({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const [year, setYear] = useState(taxYear);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const empty = { tripDate: new Date().toISOString().slice(0, 10), origin: "", destination: "", businessPurpose: "", miles: "", vehicle: "", parkingAndTolls: "" };
  const [form, setForm] = useState(empty);
  const base = `/api/clients/${clientId}/mileage`;

  async function load() {
    try { const data = await api<{ trips: Trip[]; summary: Summary }>(`${base}?year=${year}`); setTrips(data.trips); setSummary(data.summary); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load trips."); }
  }
  useEffect(() => { void load(); }, [clientId, year]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await api(base, { method: "POST", body: JSON.stringify({ ...form, miles: Number(form.miles), parkingAndTolls: Number(form.parkingAndTolls || 0), origin: form.origin || null, vehicle: form.vehicle || null }) });
      setForm({ ...empty, tripDate: form.tripDate, vehicle: form.vehicle });
      void load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the trip."); }
  }
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Car className="h-4 w-4 text-[var(--color-primary)]" />Mileage log</CardTitle>
            <CardDescription>Each trip needs a date, destination, business purpose and miles (IRC § 274(d)). Commuting from home to a regular workplace is not deductible.</CardDescription>
          </div>
          <label className="text-xs">Year <input className={`${inputClass} w-24`} inputMode="numeric" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} /></label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Trips" value={String(summary.trips)} />
            <Stat label="Business miles" value={summary.miles.toLocaleString()} />
            <Stat label="Standard mileage amount" value={usd(summary.mileageAmount)} />
            <Stat label="Plus parking and tolls" value={usd(summary.parkingAndTolls)} />
          </div>
        ) : null}
        {summary?.rates.length ? <p className="text-xs text-[var(--color-muted-foreground)]">Rates applied: {summary.rates.map((r) => `${r.miles.toLocaleString()} mi at ${r.cents}¢ (${r.source})`).join("; ")}.</p> : null}
        {summary?.unratedMiles ? <p className="text-xs text-amber-600">{summary.unratedMiles} miles fall outside the rate table and are not included in the amount.</p> : null}

        <form onSubmit={(e) => void add(e)} className="grid gap-2 sm:grid-cols-6">
          <label className="text-xs">Date<input type="date" className={inputClass} value={form.tripDate} onChange={set("tripDate")} required /></label>
          <label className="text-xs sm:col-span-2">Destination<input className={inputClass} value={form.destination} onChange={set("destination")} required /></label>
          <label className="text-xs sm:col-span-3">Business purpose<input className={inputClass} value={form.businessPurpose} onChange={set("businessPurpose")} placeholder="e.g. Meet client to review invoices" required /></label>
          <label className="text-xs">Miles<input className={inputClass} inputMode="decimal" value={form.miles} onChange={set("miles")} required /></label>
          <label className="text-xs">From (optional)<input className={inputClass} value={form.origin} onChange={set("origin")} /></label>
          <label className="text-xs">Vehicle (optional)<input className={inputClass} value={form.vehicle} onChange={set("vehicle")} /></label>
          <label className="text-xs">Parking and tolls<input className={inputClass} inputMode="decimal" value={form.parkingAndTolls} onChange={set("parkingAndTolls")} /></label>
          <div className="flex items-end sm:col-span-2"><Button type="submit" className="w-full">Add trip</Button></div>
        </form>
        {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}

        {trips.length ? (
          <ul className="divide-y divide-[var(--color-border)] text-sm">
            {trips.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{formatDate(t.trip_date)}</span> · {t.destination} · <span className="text-[var(--color-muted-foreground)]">{t.business_purpose}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                  {Number(t.miles).toLocaleString()} mi
                  <Button size="icon" variant="ghost" aria-label="Remove trip" onClick={() => void api(`${base}/${t.id}`, { method: "DELETE" }).then(load)}><Trash2 className="h-4 w-4" /></Button>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--color-muted-foreground)]">No trips logged for {year}.</p>}
      </CardContent>
    </Card>
  );
}

type HomeOfficeResult = { qualifies: boolean; problems: string[]; simplifiedDeduction: number; tentativeSimplified: number; incomeLimit: number | null; businessUsePercent: number | null; notes: string[] };

/** Home office: simplified method (Rev. Proc. 2013-13) and business-use percentage for Form 8829. */
export function HomeOfficePanel({ clientId }: { clientId: string }) {
  const [form, setForm] = useState({ officeSqFt: "", homeSqFt: "", grossIncomeFromBusinessUse: "", otherBusinessExpenses: "", regularAndExclusiveUse: false, principalPlaceOrClientMeetings: false, isEmployee: false });
  const [result, setResult] = useState<HomeOfficeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  async function compute(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      setResult(await api<HomeOfficeResult>(`/api/clients/${clientId}/home-office`, { method: "POST", body: JSON.stringify({
        officeSqFt: num(form.officeSqFt) ?? 0, homeSqFt: num(form.homeSqFt), grossIncomeFromBusinessUse: num(form.grossIncomeFromBusinessUse), otherBusinessExpenses: num(form.otherBusinessExpenses),
        regularAndExclusiveUse: form.regularAndExclusiveUse, principalPlaceOrClientMeetings: form.principalPlaceOrClientMeetings, isEmployee: form.isEmployee,
      }) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not compute."); }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Home className="h-4 w-4 text-[var(--color-primary)]" />Home office</CardTitle>
        <CardDescription>Simplified method: $5 per square foot, up to 300 square feet (Rev. Proc. 2013-13). The space must be used regularly and exclusively for the business.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void compute(e)} className="grid gap-3 sm:grid-cols-4">
          <label className="text-xs">Office sq ft<input className={inputClass} inputMode="decimal" value={form.officeSqFt} onChange={set("officeSqFt")} required /></label>
          <label className="text-xs">Whole home sq ft<input className={inputClass} inputMode="decimal" value={form.homeSqFt} onChange={set("homeSqFt")} /></label>
          <label className="text-xs">Gross income from business use<input className={inputClass} inputMode="decimal" value={form.grossIncomeFromBusinessUse} onChange={set("grossIncomeFromBusinessUse")} /></label>
          <label className="text-xs">Other business expenses<input className={inputClass} inputMode="decimal" value={form.otherBusinessExpenses} onChange={set("otherBusinessExpenses")} /></label>
          <div className="space-y-1 text-xs sm:col-span-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.regularAndExclusiveUse} onChange={set("regularAndExclusiveUse")} />Used regularly and only for the business</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.principalPlaceOrClientMeetings} onChange={set("principalPlaceOrClientMeetings")} />Principal place of business, or where clients are met</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.isEmployee} onChange={set("isEmployee")} />The client is an employee (W-2), not self-employed</label>
          </div>
          <div className="flex items-end"><Button type="submit" className="w-full">Calculate</Button></div>
        </form>
        {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
        {result ? (
          <div className="space-y-2 text-sm">
            {result.qualifies ? (
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-2xl font-semibold tabular-nums">{usd(result.simplifiedDeduction)}</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">simplified deduction{result.businessUsePercent != null ? ` · business use ${result.businessUsePercent}% for Form 8829` : ""}</span>
              </div>
            ) : <ul className="list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--color-muted-foreground)]">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Downloads every file and record for this client (service agreement section 9). */
export function ExportArchiveButton({ clientId }: { clientId: string }) {
  // The archive includes signed records, which bookkeepers and read-only members cannot open.
  const allowed = canSeeSignedRecords(useFirmRole());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(apiUrl(`/api/clients/${clientId}/export-archive`), { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed.");
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "Truepost-export.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Export failed."); }
    finally { setBusy(false); }
  }
  if (!allowed) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div>
        <p className="text-sm font-semibold">Export everything for this client</p>
        <p className="text-xs text-[var(--color-muted-foreground)]">One ZIP with every original file, signed form, consent, spreadsheet of records and a fingerprint manifest.</p>
        {error ? <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </div>
      <Button onClick={() => void download()} disabled={busy}><Download className="h-4 w-4" />{busy ? "Preparing…" : "Download ZIP"}</Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3">
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
