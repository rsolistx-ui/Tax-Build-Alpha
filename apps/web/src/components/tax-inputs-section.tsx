import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useFirmRole } from "@/lib/firm-role";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Deposits = { total: number; count: number } | null;
export type TaxInputs = {
  vehicles: Array<{ id: string; description: string; totalMiles: number; commutingMiles: number; businessMiles: number; otherPersonalMiles: number; businessUsePercent: number | null; trips: number; method: string; problems: string[] }>;
  unassignedTripMiles: number;
  homeOffice: null | {
    id: string; method: "simplified" | "regular"; officeSqFt: number; homeSqFt: number | null; regularAndExclusiveUse: boolean; principalPlaceOrClientMeetings: boolean;
    expenses: Array<{ name: string; total: number; businessShare: number }>; qualifies: boolean; problems: string[]; businessUsePercent: number | null;
    simplifiedDeduction: number | null; businessShareTotal: number | null; notes: string[];
  };
  assets: Array<{ id: string; description: string; category: string; placedInService: string; cost: number; businessUsePercent: number; businessBasis: number }>;
  forms1099: Array<{ id: string; form: string; payerName: string; amount: number; federalWithholding: number; possibleDeposits: Deposits }>;
  tieOut: { reportedOnBusiness1099s: number; bookedBusinessIncome: number; reportedMoreThanBooked: number; notes: string[] };
  estimatedPayments: {
    payments: Array<{ id: string; jurisdiction: "federal" | "state"; state: string | null; paidDate: string; quarter: number; amount: number; confirmation: string | null }>;
    federal: { byQuarter: number[]; total: number };
    states: Array<{ state: string; byQuarter: number[]; total: number }>;
  };
  unreadable: number;
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const EXPENSE_LABELS: Record<string, string> = { mortgageInterest: "Mortgage interest", realEstateTaxes: "Real estate taxes", insurance: "Insurance", rent: "Rent", utilities: "Utilities", repairs: "Repairs", other: "Other" };
const ASSET_CATEGORIES: Record<string, string> = { computer_equipment: "Computer equipment", furniture: "Furniture", machinery_equipment: "Machinery and equipment", vehicle: "Vehicle", software: "Software", building_improvement: "Building improvement", other: "Other" };
const select = "h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-sm";
const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? 0 : Number(v));

/**
 * Return inputs the preparer would otherwise dig up by hand (vehicles, home office, assets,
 * 1099s received, estimated payments). Saved per tax year; owners and preparers can edit.
 */
export function TaxInputsSection({ clientId, taxYear, inputs, onChanged }: { clientId: string; taxYear: number; inputs: TaxInputs; onChanged: () => Promise<void> }) {
  const role = useFirmRole();
  const canEdit = role === "owner" || role === "preparer";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/clients/${clientId}/tax-handoff/${taxYear}/inputs`;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const create = (kind: string, data: unknown) => run(() => api(base, { method: "POST", body: JSON.stringify({ kind, data }) }));
  const remove = (id: string) => void run(() => api(`${base}/${id}`, { method: "DELETE" }));
  const submit = (build: (f: FormData) => [string, unknown]) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const [kind, data] = build(new FormData(form));
    if (await create(kind, data)) form.reset();
  };
  const del = (id: string) => (canEdit ? <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(id)}>Remove</Button> : null);

  const ho = inputs.homeOffice;
  async function saveHomeOffice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const expenses = Object.fromEntries(Object.keys(EXPENSE_LABELS).map((k) => [k, num(f.get(k))]));
    const data = {
      method: f.get("method"), officeSqFt: num(f.get("officeSqFt")), homeSqFt: f.get("homeSqFt") ? num(f.get("homeSqFt")) : null,
      regularAndExclusiveUse: f.get("exclusive") === "on", principalPlaceOrClientMeetings: f.get("principal") === "on", expenses,
    };
    await run(() => (ho ? api(`${base}/${ho.id}`, { method: "PUT", body: JSON.stringify({ data }) }) : api(base, { method: "POST", body: JSON.stringify({ kind: "home_office", data }) })));
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Return inputs, tax year {taxYear}</CardTitle>
        <CardDescription>What the tax software asks for beyond the books. Entered here, shown with the handoff and in the spreadsheet. Truepost computes no tax.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {error ? <p className="rounded-md bg-red-500/15 px-3 py-2">{error}</p> : null}
        {inputs.unreadable > 0 ? <p className="rounded-md bg-amber-500/15 px-3 py-2">{inputs.unreadable} saved input(s) could not be read and are left out.</p> : null}

        <Block title="Vehicles (Schedule C Part IV)">
          {inputs.vehicles.map((v) => (
            <Item key={v.id} action={del(v.id)} flagged={v.problems.length > 0}>
              <span className="font-medium">{v.description}</span> · {v.totalMiles.toLocaleString()} total mi · {v.businessMiles.toLocaleString()} business mi from {v.trips} logged trip(s) · {v.commutingMiles.toLocaleString()} commuting · {v.businessUsePercent ?? 0}% business
              {v.problems.map((p) => <span key={p} className="block text-xs">{p}</span>)}
            </Item>
          ))}
          {inputs.unassignedTripMiles > 0 ? <p className="text-xs text-[var(--color-muted-foreground)]">{inputs.unassignedTripMiles} logged mile(s) name a vehicle not listed here.</p> : null}
          {canEdit ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={submit((f) => ["vehicle", {
              description: f.get("description"), totalMiles: num(f.get("totalMiles")), commutingMiles: num(f.get("commutingMiles")),
              placedInService: f.get("placedInService") || null, method: f.get("method"),
              availableForPersonalUse: f.get("personal") === "on", anotherVehicleAvailable: f.get("another") === "on",
            }])}>
              <Input name="description" placeholder="Vehicle, as named in the mileage log" aria-label="Vehicle" required className="w-64" />
              <Input name="totalMiles" type="number" min="0" placeholder="Total miles" aria-label="Total miles driven" required className="w-32" />
              <Input name="commutingMiles" type="number" min="0" placeholder="Commuting" aria-label="Commuting miles" className="w-28" />
              <Input name="placedInService" type="date" aria-label="Placed in service" className="w-40" />
              <select name="method" className={select} aria-label="Deduction method"><option value="standard_mileage">Standard mileage</option><option value="actual_expenses">Actual expenses</option></select>
              <Check name="personal" label="Available for personal use off duty" defaultChecked />
              <Check name="another" label="Another vehicle for personal use" />
              <Button type="submit" disabled={busy}>Add vehicle</Button>
            </form>
          ) : null}
        </Block>

        <Block title="Home office">
          {ho ? (
            <Item flagged={!ho.qualifies} action={del(ho.id)}>
              {ho.method === "regular" ? "Regular method (Form 8829)" : "Simplified method"} · {ho.officeSqFt} of {ho.homeSqFt ?? "?"} sq ft · {ho.businessUsePercent ?? "?"}% business
              {ho.simplifiedDeduction !== null ? <> · simplified amount {money(ho.simplifiedDeduction)}</> : null}
              {ho.businessShareTotal !== null ? <> · business share of home expenses {money(ho.businessShareTotal)}</> : null}
              {ho.problems.map((p) => <span key={p} className="block text-xs">{p}</span>)}
              {ho.notes.map((n) => <span key={n} className="block text-xs text-[var(--color-muted-foreground)]">{n}</span>)}
            </Item>
          ) : null}
          {canEdit ? (
            <form key={ho?.id ?? "new"} className="flex flex-wrap items-end gap-2" onSubmit={(e) => void saveHomeOffice(e)}>
              <select name="method" className={select} defaultValue={ho?.method ?? "simplified"} aria-label="Home office method"><option value="simplified">Simplified</option><option value="regular">Regular (Form 8829)</option></select>
              <Input name="officeSqFt" type="number" min="0" placeholder="Office sq ft" aria-label="Office square feet" defaultValue={ho?.officeSqFt ?? ""} required className="w-32" />
              <Input name="homeSqFt" type="number" min="0" placeholder="Home sq ft" aria-label="Home square feet" defaultValue={ho?.homeSqFt ?? ""} className="w-32" />
              <Check name="exclusive" label="Used regularly and only for business" defaultChecked={ho?.regularAndExclusiveUse ?? false} />
              <Check name="principal" label="Principal place of business, or meets clients there" defaultChecked={ho?.principalPlaceOrClientMeetings ?? false} />
              <div className="flex w-full flex-wrap gap-2">
                {Object.entries(EXPENSE_LABELS).map(([k, label]) => (
                  <Input key={k} name={k} type="number" min="0" step="0.01" placeholder={label} aria-label={`Home expense: ${label}`} defaultValue={ho?.expenses.find((x) => x.name === k)?.total ?? ""} className="w-36" />
                ))}
              </div>
              <Button type="submit" disabled={busy}>{ho ? "Save home office" : "Add home office"}</Button>
            </form>
          ) : null}
        </Block>

        <Block title="Assets placed in service (Form 4562)">
          {inputs.assets.map((a) => (
            <Item key={a.id} action={del(a.id)}>
              <span className="font-medium">{a.description}</span> · {ASSET_CATEGORIES[a.category] ?? a.category} · {a.placedInService} · {money(a.cost)} · {a.businessUsePercent}% business · basis {money(a.businessBasis)}
            </Item>
          ))}
          {canEdit ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={submit((f) => ["asset", {
              description: f.get("description"), category: f.get("category"), placedInService: f.get("placedInService"),
              cost: num(f.get("cost")), businessUsePercent: num(f.get("businessUsePercent")),
            }])}>
              <Input name="description" placeholder="Asset" aria-label="Asset" required className="w-56" />
              <select name="category" className={select} aria-label="Asset category">{Object.entries(ASSET_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <Input name="placedInService" type="date" aria-label="Placed in service" required className="w-40" />
              <Input name="cost" type="number" min="0" step="0.01" placeholder="Cost" aria-label="Cost" required className="w-32" />
              <Input name="businessUsePercent" type="number" min="0" max="100" placeholder="Business %" aria-label="Business use percent" defaultValue="100" required className="w-28" />
              <Button type="submit" disabled={busy}>Add asset</Button>
            </form>
          ) : null}
        </Block>

        <Block title="1099s received">
          {inputs.forms1099.map((f) => (
            <Item key={f.id} action={del(f.id)}>
              <span className="font-medium">{f.payerName}</span> · {f.form} · {money(f.amount)}{f.federalWithholding ? ` · ${money(f.federalWithholding)} withheld` : ""}
              {f.possibleDeposits ? <span className="block text-xs text-[var(--color-muted-foreground)]">{f.possibleDeposits.count} deposit(s) naming this payer, classified business income: {money(f.possibleDeposits.total)}</span> : null}
            </Item>
          ))}
          {inputs.forms1099.length > 0 ? (
            <div className={`rounded-md px-3 py-2 ${inputs.tieOut.reportedMoreThanBooked > 0 ? "bg-red-500/15" : "bg-[var(--color-muted)]"}`}>
              Business 1099s {money(inputs.tieOut.reportedOnBusiness1099s)} · booked business income {money(inputs.tieOut.bookedBusinessIncome)}
              {inputs.tieOut.notes.map((n) => <span key={n} className="block text-xs">{n}</span>)}
            </div>
          ) : null}
          {canEdit ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={submit((f) => ["form_1099", {
              form: f.get("form"), payerName: f.get("payerName"), amount: num(f.get("amount")), federalWithholding: num(f.get("withholding")),
            }])}>
              <select name="form" className={select} aria-label="Form">{["1099-NEC", "1099-MISC", "1099-K", "1099-INT", "1099-DIV", "other"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
              <Input name="payerName" placeholder="Payer" aria-label="Payer" required className="w-56" />
              <Input name="amount" type="number" min="0" step="0.01" placeholder="Amount" aria-label="Amount" required className="w-32" />
              <Input name="withholding" type="number" min="0" step="0.01" placeholder="Withheld" aria-label="Federal withholding" className="w-28" />
              <Button type="submit" disabled={busy}>Add 1099</Button>
            </form>
          ) : null}
        </Block>

        <Block title="Estimated tax payments made">
          {inputs.estimatedPayments.payments.map((p) => (
            <Item key={p.id} action={del(p.id)}>
              {p.paidDate} · {p.jurisdiction === "federal" ? "Federal" : p.state} · Q{p.quarter} · {money(p.amount)}{p.confirmation ? ` · ${p.confirmation}` : ""}
            </Item>
          ))}
          {inputs.estimatedPayments.payments.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-[var(--color-muted-foreground)]">
              <li>Federal: {inputs.estimatedPayments.federal.byQuarter.map((q, i) => `Q${i + 1} ${money(q)}`).join(" · ")} · total {money(inputs.estimatedPayments.federal.total)}</li>
              {inputs.estimatedPayments.states.map((s) => <li key={s.state}>{s.state}: {s.byQuarter.map((q, i) => `Q${i + 1} ${money(q)}`).join(" · ")} · total {money(s.total)}</li>)}
            </ul>
          ) : null}
          {canEdit ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={submit((f) => ["estimated_payment", {
              jurisdiction: f.get("jurisdiction"), state: f.get("state") ? String(f.get("state")).toUpperCase() : null, paidDate: f.get("paidDate"),
              quarter: num(f.get("quarter")), amount: num(f.get("amount")), confirmation: f.get("confirmation") || null,
            }])}>
              <select name="jurisdiction" className={select} aria-label="Federal or state"><option value="federal">Federal</option><option value="state">State</option></select>
              <Input name="state" placeholder="State (TX)" aria-label="State code" maxLength={2} className="w-24" />
              <Input name="paidDate" type="date" aria-label="Date paid" required className="w-40" />
              <select name="quarter" className={select} aria-label="Quarter">{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</select>
              <Input name="amount" type="number" min="0" step="0.01" placeholder="Amount" aria-label="Amount paid" required className="w-32" />
              <Input name="confirmation" placeholder="Confirmation" aria-label="Confirmation number" className="w-40" />
              <Button type="submit" disabled={busy}>Add payment</Button>
            </form>
          ) : null}
        </Block>
      </CardContent>
    </Card>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{title}</p>
      {children}
    </div>
  );
}

function Item({ children, action, flagged }: { children: ReactNode; action?: ReactNode; flagged?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 ${flagged ? "bg-amber-500/15" : "bg-[var(--color-muted)]"}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}
