import { describe, expect, it } from "vitest";
import { mileageRateFor, summarizeTrips, validateTrip } from "./mileage";

describe("mileage log (IRC § 274(d))", () => {
  it("applies the IRS rate in effect on each trip date, including the July 2026 change", () => {
    expect(mileageRateFor("2025-12-31")?.cents).toBe(70);
    expect(mileageRateFor("2026-06-30")?.cents).toBe(72.5);
    expect(mileageRateFor("2026-07-01")?.cents).toBe(76);
    expect(mileageRateFor("2022-05-01")).toBeNull();
  });

  it("totals miles, deduction and parking/tolls, and flags miles without a rate", () => {
    const s = summarizeTrips([
      { trip_date: "2026-03-01", miles: "100", parking_and_tolls: "5" },
      { trip_date: "2026-08-01", miles: "100", parking_and_tolls: "0" },
      { trip_date: "2022-01-01", miles: "10", parking_and_tolls: "0" },
    ]);
    expect(s).toMatchObject({ trips: 3, miles: 210, mileageAmount: 148.5, parkingAndTolls: 5, total: 153.5, unratedMiles: 10 });
  });

  it("requires date, destination, business purpose and miles", () => {
    const ok = { tripDate: "2026-03-01", destination: "Client office", businessPurpose: "Year-end review", miles: 12.34 };
    expect(validateTrip(ok).miles).toBe(12.3);
    expect(() => validateTrip({ ...ok, businessPurpose: "" })).toThrow(/business purpose/);
    expect(() => validateTrip({ ...ok, destination: " " })).toThrow(/where you went/);
    expect(() => validateTrip({ ...ok, miles: 0 })).toThrow(/miles/);
    expect(() => validateTrip({ ...ok, tripDate: "2099-01-01" })).toThrow(/future/);
  });
});
