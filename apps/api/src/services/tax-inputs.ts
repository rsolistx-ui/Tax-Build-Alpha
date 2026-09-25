import { z } from "zod";
import type { Db } from "../db";
import { computeHomeOffice } from "./home-office";

/**
 * Return inputs for the tax software handoff that do not come from the books:
 * vehicles (Schedule C Part IV, Form 4562 Part V), the home office (Form 8829 or
 * the simplified method), assets placed in service (Form 4562), 1099s received,
 * and estimated tax payments made. Stored per client and tax year in
 * client_tax_inputs. Truepost computes no tax: it adds up what was entered,
 * works out business-use percentages, and ties 1099s to booked income.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const amount = z.number().finite().min(0).max(100_000_000);
const text = (max: number) => z.string().trim().min(1).max(max);

export const TAX_INPUT_KINDS = ["vehicle", "home_office", "asset", "form_1099", "estimated_payment"] as const;
export type TaxInputKind = (typeof TAX_INPUT_KINDS)[number];

export const ASSET_CATEGORIES = ["computer_equipment", "furniture", "machinery_equipment", "vehicle", "software", "building_improvement", "other"] as const;
export const FORMS_1099 = ["1099-NEC", "1099-MISC", "1099-K", "1099-INT", "1099-DIV", "other"] as const;
/** Forms that report business receipts, so they should be in booked business income. */
const BUSINESS_1099S = new Set(["1099-NEC", "1099-MISC", "1099-K"]);
const MIN_PAYER_MATCH = 3;

export const TAX_INPUT_SCHEMAS = {
  vehicle: z.object({
    description: text(120),
    placedInService: isoDate.nullable().default(null),
    totalMiles: z.number().min(0).max(500_000),
    commutingMiles: z.number().min(0).max(500_000).default(0),
    method: z.enum(["standard_mileage", "actual_expenses"]).default("standard_mileage"),
    availableForPersonalUse: z.boolean().default(true),
    anotherVehicleAvailable: z.boolean().default(false),
  }),
  home_office: z.object({
    method: z.enum(["simplified", "regular"]),
    officeSqFt: z.number().min(0).max(100_000),
    homeSqFt: z.number().min(0).max(1_000_000).nullable().default(null),
    regularAndExclusiveUse: z.boolean(),
    principalPlaceOrClientMeetings: z.boolean(),
    expenses: z.object({
      mortgageInterest: amount, realEstateTaxes: amount, insurance: amount, rent: amount,
      utilities: amount, repairs: amount, other: amount,
    }).partial().default({}),
    homeCostBasis: amount.nullable().default(null),
    landValue: amount.nullable().default(null),
    homePlacedInService: isoDate.nullable().default(null),
  }),
  asset: z.object({
    description: text(160),
    category: z.enum(ASSET_CATEGORIES),
    placedInService: isoDate,
    cost: amount,
    businessUsePercent: z.number().min(0).max(100),
    note: z.string().trim().max(500).nullable().default(null),
  }),
  form_1099: z.object({
    form: z.enum(FORMS_1099),
    payerName: text(160),
    amount,
    federalWithholding: amount.default(0),
  }),
  estimated_payment: z.object({
    jurisdiction: z.enum(["federal", "state"]),
    state: z.string().regex(/^[A-Z]{2}$/, "Use a two-letter state code").nullable().default(null),
    paidDate: isoDate,
    quarter: z.number().int().min(1).max(4),
    amount,
    confirmation: z.string().trim().max(80).nullable().default(null),
  }).refine((p) => p.jurisdiction === "federal" || p.state !== null, { message: "Enter the state for a state payment", path: ["state"] }),
} satisfies Record<TaxInputKind, z.ZodTypeAny>;

export type TaxInputData = { [K in TaxInputKind]: z.infer<(typeof TAX_INPUT_SCHEMAS)[K]> };
export type TaxInputRow = { id: string; kind: TaxInputKind; data: unknown; updatedAt: string };

const round2 = (n: number) => Math.round(n * 100) / 100 || 0;
const round1 = (n: number) => Math.round(n * 10) / 10 || 0;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : null);
const sameName = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

export type TripForInputs = { vehicle: string | null; miles: number };

/**
 * Pure: turns the saved inputs plus a few book figures into what the preparer keys in.
 * Invalid saved rows (a schema that changed) are skipped and counted, never guessed at.
 */
export function summarizeTaxInputs(input: {
  rows: TaxInputRow[];
  trips: TripForInputs[];
  bookedBusinessIncome: number;
  tentativeProfit: number;
  depositsByPayer: Map<string, { total: number; count: number }>;
}) {
  const parsed = { vehicle: [], home_office: [], asset: [], form_1099: [], estimated_payment: [] } as { [K in TaxInputKind]: Array<{ id: string } & TaxInputData[K]> };
  let unreadable = 0;
  for (const row of input.rows) {
    const result = TAX_INPUT_SCHEMAS[row.kind].safeParse(row.data);
    if (!result.success) { unreadable += 1; continue; }
    (parsed[row.kind] as Array<unknown>).push({ id: row.id, ...(result.data as object) });
  }

  // Vehicles: business miles come from the mileage log, by the trip's vehicle name. Trips with no
  // vehicle name belong to the only vehicle when there is exactly one.
  const soleVehicle = parsed.vehicle.length === 1 ? parsed.vehicle[0] : null;
  const vehicleFor = (trip: TripForInputs) =>
    parsed.vehicle.find((v) => sameName(trip.vehicle, v.description)) ?? (!trip.vehicle?.trim() ? soleVehicle : null);
  const vehicles = parsed.vehicle.map((v) => {
    const trips = input.trips.filter((t) => vehicleFor(t) === v);
    const businessMiles = round1(trips.reduce((s, t) => s + t.miles, 0));
    const otherPersonalMiles = round1(v.totalMiles - businessMiles - v.commutingMiles);
    const problems: string[] = [];
    if (otherPersonalMiles < 0) problems.push("Business and commuting miles are more than the total miles driven.");
    if (trips.length === 0) problems.push("No mileage log trips for this vehicle. Written evidence is needed for Part IV line 47.");
    return { ...v, trips: trips.length, businessMiles, otherPersonalMiles, businessUsePercent: pct(businessMiles, v.totalMiles), writtenEvidence: trips.length > 0, problems };
  });
  const unassignedTripMiles = round1(input.trips.filter((t) => !vehicleFor(t)).reduce((s, t) => s + t.miles, 0));

  // Home office: business-use share of each home expense (Form 8829 indirect expenses), and the
  // simplified method limited by the tentative profit before the home office (Schedule C line 29).
  const ho = parsed.home_office[0] ?? null;
  const homeOffice = ho ? (() => {
    const check = computeHomeOffice({
      officeSqFt: ho.officeSqFt, homeSqFt: ho.homeSqFt, regularAndExclusiveUse: ho.regularAndExclusiveUse,
      principalPlaceOrClientMeetings: ho.principalPlaceOrClientMeetings,
      grossIncomeFromBusinessUse: Math.max(0, input.tentativeProfit), otherBusinessExpenses: 0,
    });
    const share = check.businessUsePercent ?? 0;
    const expenses = Object.entries(ho.expenses).map(([name, total]) => ({ name, total: round2(total ?? 0), businessShare: round2(((total ?? 0) * share) / 100) }));
    return {
      ...ho,
      qualifies: check.qualifies,
      problems: check.problems,
      businessUsePercent: check.businessUsePercent,
      simplifiedDeduction: ho.method === "simplified" ? check.simplifiedDeduction : null,
      expenses,
      businessShareTotal: ho.method === "regular" ? round2(expenses.reduce((s, e) => s + e.businessShare, 0)) : null,
      notes: ho.method === "regular"
        ? ["Enter the expenses on Form 8829 as indirect expenses. The tax software applies the income limit, carryovers and depreciation."]
        : check.notes,
    };
  })() : null;

  const assets = parsed.asset
    .map((a) => ({ ...a, businessBasis: round2((a.cost * a.businessUsePercent) / 100) }))
    .sort((a, b) => a.placedInService.localeCompare(b.placedInService));

  const forms1099 = parsed.form_1099.map((f) => {
    const key = f.payerName.trim().toLowerCase();
    const deposits = BUSINESS_1099S.has(f.form) && key.length >= MIN_PAYER_MATCH ? input.depositsByPayer.get(key) ?? { total: 0, count: 0 } : null;
    return { ...f, possibleDeposits: deposits };
  });
  const reportedBusiness = round2(forms1099.filter((f) => BUSINESS_1099S.has(f.form)).reduce((s, f) => s + f.amount, 0));
  const gap = round2(reportedBusiness - input.bookedBusinessIncome);
  const tieOut = {
    reportedOnBusiness1099s: reportedBusiness,
    bookedBusinessIncome: round2(input.bookedBusinessIncome),
    reportedMoreThanBooked: gap > 0.5 ? gap : 0,
    notes: [
      ...(gap > 0.5 ? ["1099s report more business income than the books. The IRS matches 1099s to the return; find the missing income or document why."] : []),
      ...(forms1099.some((f) => f.form === "1099-K") ? ["A 1099-K reports gross payments before refunds and fees; reconcile it to gross receipts, not net deposits."] : []),
    ],
  };

  const payments = [...parsed.estimated_payment].sort((a, b) => a.paidDate.localeCompare(b.paidDate));
  const quarterTotals = (rows: typeof payments) =>
    [1, 2, 3, 4].map((q) => round2(rows.filter((p) => p.quarter === q).reduce((s, p) => s + p.amount, 0)));
  const federal = payments.filter((p) => p.jurisdiction === "federal");
  const states = [...new Set(payments.filter((p) => p.state).map((p) => p.state as string))].sort();
  const estimatedPayments = {
    payments,
    federal: { byQuarter: quarterTotals(federal), total: round2(federal.reduce((s, p) => s + p.amount, 0)) },
    states: states.map((st) => {
      const rows = payments.filter((p) => p.jurisdiction === "state" && p.state === st);
      return { state: st, byQuarter: quarterTotals(rows), total: round2(rows.reduce((s, p) => s + p.amount, 0)) };
    }),
  };

  return { vehicles, unassignedTripMiles, homeOffice, assets, forms1099, tieOut, estimatedPayments, unreadable };
}

export type TaxInputsSummary = ReturnType<typeof summarizeTaxInputs>;

export async function loadTaxInputsSummary(db: Db, input: { firmId: string; clientId: string; taxYear: number; bookedBusinessIncome: number; tentativeProfit: number }) {
  const { firmId, clientId, taxYear } = input;
  const [rows, trips] = await Promise.all([
    db.query<{ id: string; kind: TaxInputKind; data: unknown; updated_at: string }>(
      `SELECT id, kind, data, updated_at::text AS updated_at FROM client_tax_inputs
        WHERE firm_id = $1 AND client_id = $2 AND tax_year = $3 ORDER BY created_at`,
      [firmId, clientId, taxYear],
    ),
    db.query<{ vehicle: string | null; miles: string }>(
      `SELECT vehicle, miles::text FROM mileage_trips
        WHERE firm_id = $1 AND client_id = $2 AND deleted_at IS NULL
          AND trip_date >= make_date($3, 1, 1) AND trip_date <= make_date($3, 12, 31)`,
      [firmId, clientId, taxYear],
    ),
  ]);
  // Deposits classified business income whose description contains the payer's name: a possible match, not proof.
  // Names under MIN_PAYER_MATCH characters would match unrelated deposits ("Co" in "Costco"), so they get no match.
  const payers = [...new Set(rows.filter((r) => r.kind === "form_1099").map((r) => String((r.data as { payerName?: string })?.payerName ?? "").trim().toLowerCase()).filter((p) => p.length >= MIN_PAYER_MATCH))];
  const depositRows = payers.length === 0 ? [] : await db.query<{ payer: string; total: string; count: string }>(
    `SELECT p.payer, COALESCE(SUM(bt.amount), 0)::text AS total, COUNT(bt.id)::text AS count
       FROM jsonb_array_elements_text($2::jsonb) AS p(payer)
       LEFT JOIN bank_transactions bt ON bt.client_id = $1 AND bt.disposition = 'business_income'
            AND bt.txn_date >= make_date($3, 1, 1) AND bt.txn_date <= make_date($3, 12, 31)
            AND position(p.payer IN lower(COALESCE(bt.description, ''))) > 0
      GROUP BY p.payer`,
    [clientId, JSON.stringify(payers), taxYear],
  );
  const depositsByPayer = new Map(depositRows.map((d) => [d.payer, { total: round2(Number(d.total)), count: Number(d.count) }]));
  return summarizeTaxInputs({
    rows: rows.map((r) => ({ id: r.id, kind: r.kind, data: r.data, updatedAt: r.updated_at })),
    trips: trips.map((t) => ({ vehicle: t.vehicle, miles: Number(t.miles) })),
    bookedBusinessIncome: input.bookedBusinessIncome,
    tentativeProfit: input.tentativeProfit,
    depositsByPayer,
  });
}
