import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calculator, Sparkles, Trash2, CheckCircle2 } from "lucide-react";

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
        {cfs.some((c) => c.tax_year_expires && c.status === "active") && <CardDescription className="text-xs text-amber-600">Some carryforwards expire. Review before posting.</CardDescription>}
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
            <Badge className={c.status === "fully_used" ? "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300" : c.tax_year_expires ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"}>{c.status}</Badge>
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
  const [showManualForm, setShowManualForm] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardState, setWizardState] = useState<"CA" | "NY">("CA");
  const [wizardInputs, setWizardInputs] = useState({
    federalBonusDepreciation: "",
    californiaAllowableDepreciation: "",
    federalSection179Deduction: "",
    section179PropertyCost: "",
    hsaContributionsDeducted: "",
    hsaEarningsTaxable: "",
    isCaliforniaLlc: false,
    californiaGrossReceipts: "",
    californiaPteTaxPaid: "",
    californiaPteJunePayment: "unknown" as "unknown" | "made" | "missed",
    newYorkAllowableDepreciation: "",
    stateLocalTaxDeductedFed: "",
    mctdNetSelfEmploymentEarnings: "",
    mctdZone: 1 as 1 | 2,
    nyPtetTaxPaid: "",
  });
  const [computedResult, setComputedResult] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const [applying, setApplying] = useState(false);

  const [form, setForm] = useState({ state: "", modificationType: "addition", description: "", amount: "", federalLineCode: "", stateLineCode: "", apportionmentFactor: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<{ mods: any[] }>(`/api/clients/${clientId}/state-mods/${taxYear}`).then((d) => setMods(d.mods)).catch(() => {});
  }, [clientId, taxYear]);
  useEffect(() => { load(); }, [load]);

  async function handleComputeConformity(applyImmediately: boolean = false) {
    if (applyImmediately) setApplying(true);
    else setCalculating(true);
    try {
      const payload: any = {
        state: wizardState,
        taxYear: Number(taxYear),
        applyImmediately,
        federalBonusDepreciation: wizardInputs.federalBonusDepreciation ? Number(wizardInputs.federalBonusDepreciation) : undefined,
      };

      if (wizardState === "CA") {
        payload.californiaAllowableDepreciation = wizardInputs.californiaAllowableDepreciation ? Number(wizardInputs.californiaAllowableDepreciation) : undefined;
        payload.federalSection179Deduction = wizardInputs.federalSection179Deduction ? Number(wizardInputs.federalSection179Deduction) : undefined;
        payload.section179PropertyCost = wizardInputs.section179PropertyCost ? Number(wizardInputs.section179PropertyCost) : undefined;
        payload.hsaContributionsDeducted = wizardInputs.hsaContributionsDeducted ? Number(wizardInputs.hsaContributionsDeducted) : undefined;
        payload.hsaEarningsTaxable = wizardInputs.hsaEarningsTaxable ? Number(wizardInputs.hsaEarningsTaxable) : undefined;
        payload.isCaliforniaLlc = wizardInputs.isCaliforniaLlc;
        payload.californiaGrossReceipts = wizardInputs.californiaGrossReceipts ? Number(wizardInputs.californiaGrossReceipts) : undefined;
        payload.californiaPteTaxPaid = wizardInputs.californiaPteTaxPaid ? Number(wizardInputs.californiaPteTaxPaid) : undefined;
        payload.californiaPteJunePaymentMade = wizardInputs.californiaPteJunePayment === "unknown" ? undefined : wizardInputs.californiaPteJunePayment === "made";
      } else {
        payload.newYorkAllowableDepreciation = wizardInputs.newYorkAllowableDepreciation ? Number(wizardInputs.newYorkAllowableDepreciation) : undefined;
        payload.stateLocalTaxDeductedFed = wizardInputs.stateLocalTaxDeductedFed ? Number(wizardInputs.stateLocalTaxDeductedFed) : undefined;
        payload.mctdNetSelfEmploymentEarnings = wizardInputs.mctdNetSelfEmploymentEarnings ? Number(wizardInputs.mctdNetSelfEmploymentEarnings) : undefined;
        payload.mctdZone = wizardInputs.mctdZone;
        payload.nyPtetTaxPaid = wizardInputs.nyPtetTaxPaid ? Number(wizardInputs.nyPtetTaxPaid) : undefined;
      }

      const res = await api<{ result: any; appliedCount: number }>(`/api/clients/${clientId}/state-mods/calculate-conformity`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setComputedResult(res.result);
      if (applyImmediately) {
        setShowWizard(false);
        setComputedResult(null);
        load();
      }
    } finally {
      setCalculating(false);
      setApplying(false);
    }
  }

  async function handleDeleteMod(modId: string) {
    if (!confirm("Are you sure you want to delete this state modification?")) return;
    try {
      await api(`/api/clients/${clientId}/state-mods/${modId}`, { method: "DELETE" });
      load();
    } catch {}
  }

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
      setShowManualForm(false);
      setForm({ state: "", modificationType: "addition", description: "", amount: "", federalLineCode: "", stateLineCode: "", apportionmentFactor: "" });
      load();
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">State Conformity & Modifications: {taxYear}</CardTitle>
            <CardDescription className="text-xs">
              Automated California (CA 540) & New York (IT-201 / IT-225) statutory adjustments
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={showWizard ? "secondary" : "default"}
              onClick={() => { setShowWizard((v) => !v); setShowManualForm(false); }}
              className="flex items-center gap-1 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {showWizard ? "Close Wizard" : "⚡ State Conformity Wizard"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setShowManualForm((v) => !v); setShowWizard(false); }}
              className="text-xs"
            >
              {showManualForm ? "Cancel" : "+ Manual Entry"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* State Conformity Wizard */}
        {showWizard && (
          <div className="space-y-3 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-4">
            <div className="flex items-center justify-between border-b border-[var(--color-border)]/80 pb-2">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-[var(--color-primary)]" />
                <span className="font-semibold text-xs text-[var(--color-foreground)]">
                  Automated State Conformity Engine
                </span>
              </div>
              <div className="flex rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-0.5">
                <button
                  type="button"
                  onClick={() => { setWizardState("CA"); setComputedResult(null); }}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    wizardState === "CA"
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  }`}
                >
                  California (CA 540 / Sch CA)
                </button>
                <button
                  type="button"
                  onClick={() => { setWizardState("NY"); setComputedResult(null); }}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    wizardState === "NY"
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  }`}
                >
                  New York (IT-201 / IT-225)
                </button>
              </div>
            </div>

            {wizardState === "CA" ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[var(--color-muted-foreground)]">Federal Bonus Depreciation (IRC § 168(k))</label>
                  <Input
                    placeholder="e.g. 50000"
                    value={wizardInputs.federalBonusDepreciation}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, federalBonusDepreciation: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">CA does not allow bonus depr. (R&TC § 17250)</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">CA Allowable Regular MACRS Depreciation</label>
                  <Input
                    placeholder="e.g. 10000"
                    value={wizardInputs.californiaAllowableDepreciation}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, californiaAllowableDepreciation: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">Subtraction modification in Col B</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">Federal Section 179 Expense Claimed</label>
                  <Input
                    placeholder="e.g. 65000"
                    value={wizardInputs.federalSection179Deduction}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, federalSection179Deduction: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">Adds back excess over the CA $25,000 limit (R&TC § 17255)</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">Total cost of Section 179 property placed in service</label>
                  <Input
                    placeholder="e.g. 210000"
                    value={wizardInputs.section179PropertyCost}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, section179PropertyCost: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">CA limit drops dollar-for-dollar above $200,000</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">HSA Contribution Deducted (Fed Sch 1 Ln 13)</label>
                  <Input
                    placeholder="e.g. 4150"
                    value={wizardInputs.hsaContributionsDeducted}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, hsaContributionsDeducted: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">CA non-conformity to IRC § 223</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">CA Pass-Through Entity Elective Tax paid</label>
                  <Input
                    placeholder="e.g. 9300"
                    value={wizardInputs.californiaPteTaxPaid}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, californiaPteTaxPaid: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">FTB 3804-CR credit (entity handles the add-back)</span>
                  <select
                    className="mt-1 h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                    value={wizardInputs.californiaPteJunePayment}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, californiaPteJunePayment: e.target.value as "unknown" | "made" | "missed" }))}
                  >
                    <option value="unknown">2026+: June 15 prepayment not confirmed</option>
                    <option value="made">2026+: June 15 prepayment made</option>
                    <option value="missed">2026+: June 15 prepayment missed (credit reduced 12.5%)</option>
                  </select>
                </div>
                <div className="space-y-1 rounded border border-[var(--color-border)] p-2">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={wizardInputs.isCaliforniaLlc}
                      onChange={(e) => setWizardInputs((w) => ({ ...w, isCaliforniaLlc: e.target.checked }))}
                    />
                    California LLC Entity ($800 Min Tax)
                  </label>
                  {wizardInputs.isCaliforniaLlc && (
                    <Input
                      placeholder="CA total income: gross income + COGS (e.g. 600000)"
                      value={wizardInputs.californiaGrossReceipts}
                      onChange={(e) => setWizardInputs((w) => ({ ...w, californiaGrossReceipts: e.target.value }))}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[var(--color-muted-foreground)]">Federal Bonus Depreciation (IRC § 168(k))</label>
                  <Input
                    placeholder="e.g. 80000"
                    value={wizardInputs.federalBonusDepreciation}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, federalBonusDepreciation: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">Form IT-225 A-209 add-back (Form IT-398)</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">New York Allowable Regular MACRS Depreciation</label>
                  <Input
                    placeholder="e.g. 16000"
                    value={wizardInputs.newYorkAllowableDepreciation}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, newYorkAllowableDepreciation: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">Form IT-225 S-213 subtraction (Form IT-398)</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">Income taxes deducted as a business expense (e.g. NYC UBT)</label>
                  <Input
                    placeholder="e.g. 10000"
                    value={wizardInputs.stateLocalTaxDeductedFed}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, stateLocalTaxDeductedFed: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">Form IT-225 A-201 add-back. Schedule A taxes go on IT-196, not here</span>
                </div>
                <div>
                  <label className="text-[var(--color-muted-foreground)]">NY Pass-Through Entity Tax (PTET)</label>
                  <Input
                    placeholder="e.g. 12000"
                    value={wizardInputs.nyPtetTaxPaid}
                    onChange={(e) => setWizardInputs((w) => ({ ...w, nyPtetTaxPaid: e.target.value }))}
                  />
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">Form IT-653 credit + Code A-219 add-back</span>
                </div>
                <div className="col-span-2 space-y-1 rounded border border-[var(--color-border)] p-2">
                  <label className="font-medium text-[var(--color-foreground)]">
                    Metropolitan Commuter Transportation Mobility Tax (MCTMT)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="MCTD Net Self-Employment Earnings (e.g. 150000)"
                      value={wizardInputs.mctdNetSelfEmploymentEarnings}
                      onChange={(e) => setWizardInputs((w) => ({ ...w, mctdNetSelfEmploymentEarnings: e.target.value }))}
                    />
                    <select
                      className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                      value={wizardInputs.mctdZone}
                      onChange={(e) => setWizardInputs((w) => ({ ...w, mctdZone: Number(e.target.value) as 1 | 2 }))}
                    >
                      <option value={1}>Zone 1 (NYC - 0.60%)</option>
                      <option value={2}>Zone 2 (Suburbs - 0.34%)</option>
                    </select>
                  </div>
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">
                    Applies if MCTD net self-employment earnings exceed $50,000 threshold (Article 23 § 801).
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleComputeConformity(false)}
                disabled={calculating}
                className="text-xs"
              >
                {calculating ? "Calculating..." : "Preview Calculations"}
              </Button>
              {computedResult && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleComputeConformity(true)}
                  disabled={applying}
                  className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 text-xs"
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  {applying ? "Applying to Workpapers..." : "Apply All to Client Workpaper (1-Click)"}
                </Button>
              )}
            </div>

            {/* Computed Preview Results */}
            {computedResult && (
              <div className="mt-3 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs">
                <div className="flex flex-wrap gap-4 font-mono font-medium">
                  <span className="text-amber-600 dark:text-amber-400">
                    Additions: +${computedResult.totalAdditions.toLocaleString()}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Subtractions: -${computedResult.totalSubtractions.toLocaleString()}
                  </span>
                  <span className="text-blue-600 dark:text-blue-400">
                    Credits: ${computedResult.totalCredits.toLocaleString()}
                  </span>
                </div>

                {computedResult.specialTaxesOrFees?.length > 0 && (
                  <div className="rounded bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                    <span className="font-semibold">Special Statutory Taxes & Fees:</span>
                    {computedResult.specialTaxesOrFees.map((fee: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-[11px] pt-1">
                        <span>{fee.title} ({fee.statutoryCitation}):</span>
                        <span className="font-mono font-bold">${fee.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}

                {computedResult.notes?.length > 0 && (
                  <ul className="list-disc space-y-0.5 rounded bg-sky-500/10 p-2 pl-5 text-[11px] text-sky-800 dark:text-sky-200">
                    {computedResult.notes.map((note: string, idx: number) => <li key={idx}>{note}</li>)}
                  </ul>
                )}

                <div className="space-y-1 divide-y divide-[var(--color-border)]/40 pt-1">
                  {computedResult.modifications.map((m: any, idx: number) => (
                    <div key={idx} className="flex items-start justify-between gap-2 pt-1">
                      <div>
                        <div className="font-medium text-[var(--color-foreground)]">{m.description}</div>
                        <div className="text-[10px] text-[var(--color-muted-foreground)]">
                          {m.stateLineCode} · {m.statutoryReference}
                        </div>
                      </div>
                      <span className="font-mono font-semibold">
                        {m.modificationType === "subtraction" ? "-" : "+"}${m.amount.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manual Addition Form */}
        {showManualForm && (
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
            <Input placeholder="State code (CA, NY...)" maxLength={2} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
            <select value={form.modificationType} onChange={(e) => setForm((f) => ({ ...f, modificationType: e.target.value }))} className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm">
              <option value="addition">Addition</option>
              <option value="subtraction">Subtraction</option>
              <option value="credit">Credit</option>
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

        {/* Active Modifications List */}
        {mods.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No state modifications for {taxYear}. Click &quot;⚡ State Conformity Wizard&quot; to auto-calculate.</p>
        ) : (
          mods.map((m: any) => (
            <div key={m.id} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
              <Badge className={m.state === "CA" ? "bg-amber-500/10 text-amber-600 border-amber-500/30" : "bg-blue-500/10 text-blue-600 border-blue-500/30"}>
                {m.state}
              </Badge>
              <div className="flex flex-col">
                <span className="font-medium">{m.description}</span>
                {m.state_line_code && (
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">
                    Form Line: {m.state_line_code}
                  </span>
                )}
              </div>
              <span className="ml-auto font-mono font-medium">
                {m.modification_type === "subtraction" ? "-" : "+"}${Number(m.amount).toLocaleString()}
              </span>
              <button
                onClick={() => handleDeleteMod(m.id)}
                className="ml-2 rounded p-1 text-[var(--color-muted-foreground)] hover:bg-rose-500/10 hover:text-rose-600"
                title="Delete modification"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
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
          <CardTitle className="text-sm">M-3: {taxYear}</CardTitle>
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
      <CardHeader className="pb-2"><CardTitle className="text-sm">Prior Year Compare: {data.priorYear} vs {data.taxYear}</CardTitle><CardDescription className="text-xs">{data.priorCount} lines in {data.priorYear} · {data.currentCount} lines in {data.taxYear}</CardDescription></CardHeader>
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

export function OrganizerPanel({ clientId, taxForm, taxYear }: { clientId: string; taxForm: string; taxYear: number }) {
  const [checklist, setChecklist] = useState<any[]>([]);
  const [prefillResult, setPrefillResult] = useState<string | null>(null);
  useEffect(() => {
    api<{ checklist: any[] }>(`/api/clients/${clientId}/tax-organizer/${taxForm}`).then((d) => setChecklist(d.checklist)).catch(() => {});
  }, [clientId, taxForm]);
  async function prefillFromPriorYear() {
    try {
      const r = await api<{ added: number }>(`/api/clients/${clientId}/tax-readiness/${taxYear}/checklist/prefill-prior-year`, { method: "POST" });
      setPrefillResult(r.added === 0 ? `Nothing to copy from ${taxYear - 1}.` : `Added ${r.added} document(s) from ${taxYear - 1} to the ${taxYear} checklist.`);
    } catch (e) {
      setPrefillResult(e instanceof Error ? e.message : "Could not copy last year's checklist.");
    }
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Organizer: {taxForm}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => void prefillFromPriorYear()}>Copy {taxYear - 1} checklist</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {prefillResult ? <p className="text-xs text-[var(--color-muted-foreground)]">{prefillResult}</p> : null}
        {checklist.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No organizer items.</p> : checklist.map((c: any) => (
          <div key={c.code} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
            <span>{c.label}</span>
            {c.required ? <Badge className="bg-red-100 text-red-800">required</Badge> : null}
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
          <CardTitle className="text-sm">Diagnostics: {taxYear}</CardTitle>
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
