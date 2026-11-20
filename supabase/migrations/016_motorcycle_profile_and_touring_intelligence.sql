-- Phase 2 Milestone 5: Motorcycle Profile & Touring Intelligence
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS motorcycle_make TEXT,
  ADD COLUMN IF NOT EXISTS motorcycle_model TEXT,
  ADD COLUMN IF NOT EXISTS fuel_tank_capacity_liters NUMERIC(5,2) CHECK (fuel_tank_capacity_liters IS NULL OR (fuel_tank_capacity_liters > 0 AND fuel_tank_capacity_liters <= 100)),
  ADD COLUMN IF NOT EXISTS mileage_km_per_liter NUMERIC(5,2) CHECK (mileage_km_per_liter IS NULL OR (mileage_km_per_liter > 0 AND mileage_km_per_liter <= 150)),
  ADD COLUMN IF NOT EXISTS fuel_reserve_liters NUMERIC(5,2) CHECK (fuel_reserve_liters IS NULL OR (fuel_reserve_liters >= 0 AND fuel_reserve_liters <= 30)),
  ADD COLUMN IF NOT EXISTS motorcycle_category TEXT CHECK (motorcycle_category IS NULL OR motorcycle_category IN ('adventure','tourer','cruiser','sport','commuter','scooter'));

COMMIT;
