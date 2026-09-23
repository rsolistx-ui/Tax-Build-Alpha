-- Business mileage log. IRC § 274(d) and Treas. Reg. § 1.274-5T(b)(6) require, for each
-- use of a vehicle, the amount (miles), the time (date), and the business purpose; the
-- destination documents the place. All four are required columns.

CREATE TABLE IF NOT EXISTS mileage_trips (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  trip_date DATE NOT NULL,
  origin TEXT,
  destination TEXT NOT NULL CHECK (length(trim(destination)) > 0),
  business_purpose TEXT NOT NULL CHECK (length(trim(business_purpose)) > 0),
  miles NUMERIC(8,1) NOT NULL CHECK (miles > 0 AND miles < 5000),
  vehicle TEXT,
  parking_and_tolls NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (parking_and_tolls >= 0),
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mileage_trips_client_date ON mileage_trips(client_id, trip_date) WHERE deleted_at IS NULL;
