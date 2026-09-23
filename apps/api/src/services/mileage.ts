import type { Db } from "../db";
import { newId } from "../lib/id";

/**
 * Business standard mileage rates, from irs.gov/tax-professionals/standard-mileage-rates
 * (checked 2026-09-23). 2026 changed mid-year: 72.5 cents Jan 1 - Jun 30 (IR-2025-128),
 * 76 cents Jul 1 - Dec 31 (IR-2026-29). A trip outside the table gets no computed amount.
 */
export const BUSINESS_MILEAGE_RATES: Array<{ from: string; to: string; cents: number; source: string }> = [
  { from: "2023-01-01", to: "2023-12-31", cents: 65.5, source: "IR-2022-234" },
  { from: "2024-01-01", to: "2024-12-31", cents: 67, source: "IR-2023-239" },
  { from: "2025-01-01", to: "2025-12-31", cents: 70, source: "IR-2024-312" },
  { from: "2026-01-01", to: "2026-06-30", cents: 72.5, source: "IR-2025-128" },
  { from: "2026-07-01", to: "2026-12-31", cents: 76, source: "IR-2026-29" },
];

export function mileageRateFor(date: string) {
  return BUSINESS_MILEAGE_RATES.find((r) => date >= r.from && date <= r.to) ?? null;
}

export class MileageError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 422 = 422) { super(message); }
}

export type TripInput = {
  tripDate: string; origin?: string | null; destination: string; businessPurpose: string;
  miles: number; vehicle?: string | null; parkingAndTolls?: number;
};

/** IRC § 274(d): date, destination, business purpose and miles are all required. */
export function validateTrip(input: TripInput): TripInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tripDate) || Number.isNaN(Date.parse(input.tripDate))) throw new MileageError("Enter the trip date.");
  if (new Date(`${input.tripDate}T00:00:00Z`).getTime() > Date.now() + 86_400_000) throw new MileageError("The trip date cannot be in the future.");
  if (!input.destination?.trim()) throw new MileageError("Enter where you went.");
  if (!input.businessPurpose?.trim() || input.businessPurpose.trim().length < 3) throw new MileageError("Enter the business purpose of the trip.");
  if (!(input.miles > 0) || input.miles >= 5000) throw new MileageError("Enter the miles driven.");
  if ((input.parkingAndTolls ?? 0) < 0) throw new MileageError("Parking and tolls cannot be negative.");
  return { ...input, destination: input.destination.trim(), businessPurpose: input.businessPurpose.trim(), miles: Math.round(input.miles * 10) / 10 };
}

export async function addTrip(db: Db, firmId: string, clientId: string, userId: string, input: TripInput) {
  const t = validateTrip(input);
  const [row] = await db.query(
    `INSERT INTO mileage_trips (id, firm_id, client_id, trip_date, origin, destination, business_purpose, miles, vehicle, parking_and_tolls, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [newId("trip"), firmId, clientId, t.tripDate, t.origin?.trim() || null, t.destination, t.businessPurpose, t.miles, t.vehicle?.trim() || null, t.parkingAndTolls ?? 0, userId],
  );
  return row;
}

export async function listTrips(db: Db, firmId: string, clientId: string, year: number) {
  return db.query<{ id: string; trip_date: string; origin: string | null; destination: string; business_purpose: string; miles: string; vehicle: string | null; parking_and_tolls: string }>(
    `SELECT id, trip_date::text, origin, destination, business_purpose, miles::text, vehicle, parking_and_tolls::text
     FROM mileage_trips WHERE firm_id=$1 AND client_id=$2 AND deleted_at IS NULL AND EXTRACT(YEAR FROM trip_date)=$3
     ORDER BY trip_date DESC, created_at DESC`,
    [firmId, clientId, year],
  );
}

export async function removeTrip(db: Db, firmId: string, clientId: string, tripId: string) {
  const rows = await db.query(`UPDATE mileage_trips SET deleted_at=NOW() WHERE id=$1 AND firm_id=$2 AND client_id=$3 AND deleted_at IS NULL RETURNING id`, [tripId, firmId, clientId]);
  if (!rows.length) throw new MileageError("Trip not found.", 404);
}

/** Standard mileage deduction: each trip's miles times the rate in effect on its date, plus parking and tolls. */
export function summarizeTrips(trips: Array<{ trip_date: string; miles: string | number; parking_and_tolls: string | number }>) {
  let miles = 0, mileageAmount = 0, parkingAndTolls = 0, unratedMiles = 0;
  const byRate = new Map<string, { cents: number; source: string; miles: number }>();
  for (const trip of trips) {
    const m = Number(trip.miles);
    miles += m;
    parkingAndTolls += Number(trip.parking_and_tolls);
    const rate = mileageRateFor(trip.trip_date);
    if (!rate) { unratedMiles += m; continue; }
    mileageAmount += m * rate.cents / 100;
    const entry = byRate.get(rate.from) ?? { cents: rate.cents, source: rate.source, miles: 0 };
    entry.miles += m;
    byRate.set(rate.from, entry);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    trips: trips.length,
    miles: Math.round(miles * 10) / 10,
    mileageAmount: round(mileageAmount),
    parkingAndTolls: round(parkingAndTolls),
    total: round(mileageAmount + parkingAndTolls),
    rates: [...byRate.values()].map((r) => ({ ...r, miles: Math.round(r.miles * 10) / 10 })),
    unratedMiles: Math.round(unratedMiles * 10) / 10,
  };
}
