-- RideNTrack Database Schema
-- Supabase Migration: 002 Offline Batch Sync & Location Storage Optimizations

-- Batch insert function for offline breadcrumb sync
CREATE OR REPLACE FUNCTION bulk_insert_location_updates(updates JSONB)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  -- Insert batch of location updates from JSON array
  WITH data_rows AS (
    SELECT
      (item->>'ride_id')::UUID AS ride_id,
      (item->>'user_id')::UUID AS user_id,
      (item->>'lat')::DOUBLE PRECISION AS lat,
      (item->>'lng')::DOUBLE PRECISION AS lng,
      COALESCE((item->>'speed')::DOUBLE PRECISION, 0) AS speed,
      COALESCE((item->>'heading')::DOUBLE PRECISION, 0) AS heading,
      COALESCE((item->>'timestamp')::TIMESTAMPTZ, NOW()) AS timestamp
    FROM jsonb_array_elements(updates) AS item
  )
  INSERT INTO public.location_updates (ride_id, user_id, lat, lng, speed, heading, timestamp)
  SELECT ride_id, user_id, lat, lng, speed, heading, timestamp
  FROM data_rows
  WHERE auth.uid() = user_id; -- Security: riders can only insert their own records

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optimize index on location updates for timeline queries
CREATE INDEX IF NOT EXISTS idx_location_updates_ride_user_time 
  ON public.location_updates (ride_id, user_id, timestamp DESC);
