-- Phase 1: atomic trip aggregate creation and day-aware waypoints.
BEGIN;

ALTER TABLE public.trip_waypoints
  ADD COLUMN IF NOT EXISTS trip_day_id UUID
  REFERENCES public.trip_days(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trip_waypoints_day_sequence
  ON public.trip_waypoints(trip_day_id, sequence);

CREATE OR REPLACE FUNCTION public.create_trip_plan(
  p_trip JSONB,
  p_waypoints JSONB,
  p_days JSONB DEFAULT '[]'::jsonb,
  p_stay JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ride_id UUID;
  v_day_count INTEGER;
  v_waypoint_count INTEGER;
  v_stay_price NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_trip IS NULL OR jsonb_typeof(p_trip) <> 'object' THEN
    RAISE EXCEPTION 'Trip details must be an object';
  END IF;
  IF p_waypoints IS NULL OR jsonb_typeof(p_waypoints) <> 'array' OR jsonb_array_length(p_waypoints) < 2
     OR jsonb_array_length(p_waypoints) > 200 THEN
    RAISE EXCEPTION 'Trip must contain between 2 and 200 waypoints';
  END IF;
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array'
     OR jsonb_array_length(p_days) > 31 THEN
    RAISE EXCEPTION 'Trip days must be an array with at most 31 entries';
  END IF;

  v_day_count := jsonb_array_length(p_days);
  v_waypoint_count := jsonb_array_length(p_waypoints);

  IF NULLIF(trim(p_trip->>'name'), '') IS NULL
     OR NULLIF(trim(p_trip->>'origin'), '') IS NULL
     OR NULLIF(trim(p_trip->>'destination'), '') IS NULL
     OR jsonb_typeof(p_trip->'origin_coords') <> 'array'
     OR jsonb_array_length(p_trip->'origin_coords') <> 2
     OR jsonb_typeof(p_trip->'destination_coords') <> 'array'
     OR jsonb_array_length(p_trip->'destination_coords') <> 2 THEN
    RAISE EXCEPTION 'Trip name, origin, destination and coordinates are required';
  END IF;

  IF NULLIF(p_trip->>'start_date', '') IS NOT NULL
     AND NULLIF(p_trip->>'end_date', '') IS NOT NULL
     AND (p_trip->>'end_date')::date < (p_trip->>'start_date')::date THEN
    RAISE EXCEPTION 'Trip end date must be on or after start date';
  END IF;

  IF p_stay IS NOT NULL AND jsonb_typeof(p_stay) <> 'object' THEN
    RAISE EXCEPTION 'Stay details must be an object';
  END IF;
  IF p_stay IS NOT NULL AND NULLIF(p_stay->>'price_amount', '') IS NOT NULL THEN
    v_stay_price := (p_stay->>'price_amount')::numeric;
    IF v_stay_price < 0 THEN
      RAISE EXCEPTION 'Stay price cannot be negative';
    END IF;
  END IF;

  INSERT INTO public.rides (
    name, description, trip_type, visibility, start_date, end_date,
    admin_id, origin, destination, origin_coords, destination_coords,
    route_geometry, estimated_distance_meters, estimated_duration_seconds
  ) VALUES (
    trim(p_trip->>'name'),
    NULLIF(trim(p_trip->>'description'), ''),
    COALESCE(NULLIF(p_trip->>'trip_type', ''), 'group'),
    COALESCE(NULLIF(p_trip->>'visibility', ''), 'invite_only'),
    NULLIF(p_trip->>'start_date', '')::date,
    NULLIF(p_trip->>'end_date', '')::date,
    v_user_id,
    trim(p_trip->>'origin'),
    trim(p_trip->>'destination'),
    p_trip->'origin_coords',
    p_trip->'destination_coords',
    p_trip->'route_geometry',
    NULLIF(p_trip->>'estimated_distance_meters', '')::integer,
    NULLIF(p_trip->>'estimated_duration_seconds', '')::integer
  )
  RETURNING id INTO v_ride_id;

  INSERT INTO public.trip_days (ride_id, day_number, trip_date, title)
  SELECT v_ride_id, d.day_number, d.trip_date, COALESCE(d.title, 'Day ' || d.day_number)
  FROM jsonb_to_recordset(p_days) AS d(
    day_number INTEGER,
    trip_date DATE,
    title TEXT
  )
  ORDER BY d.day_number;

  INSERT INTO public.trip_waypoints (
    ride_id, sequence, waypoint_type, name, address,
    latitude, longitude, provider_place_id, notes, is_optional,
    planned_arrival, planned_departure, trip_day_id
  )
  SELECT
    v_ride_id,
    w.sequence,
    w.waypoint_type,
    w.name,
    w.address,
    w.latitude,
    w.longitude,
    w.provider_place_id,
    w.notes,
    COALESCE(w.is_optional, false),
    w.planned_arrival,
    w.planned_departure,
    td.id
  FROM jsonb_to_recordset(p_waypoints) AS w(
    sequence INTEGER,
    waypoint_type TEXT,
    name TEXT,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    provider_place_id TEXT,
    notes TEXT,
    is_optional BOOLEAN,
    planned_arrival TIMESTAMPTZ,
    planned_departure TIMESTAMPTZ,
    day_number INTEGER
  )
  LEFT JOIN public.trip_days td
    ON td.ride_id = v_ride_id AND td.day_number = w.day_number
  ORDER BY w.sequence;

  IF p_stay IS NOT NULL THEN
    INSERT INTO public.trip_stays (
      ride_id, trip_day_id, name, stay_type, address, latitude, longitude,
      provider_place_id, check_in, check_out, booking_reference,
      price_amount, price_currency, contact_phone, notes
    )
    SELECT
      v_ride_id,
      td.id,
      trim(p_stay->>'name'),
      COALESCE(NULLIF(p_stay->>'stay_type', ''), 'hotel'),
      NULLIF(p_stay->>'address', ''),
      NULLIF(p_stay->>'latitude', '')::double precision,
      NULLIF(p_stay->>'longitude', '')::double precision,
      NULLIF(p_stay->>'provider_place_id', ''),
      NULLIF(p_stay->>'check_in', '')::date,
      NULLIF(p_stay->>'check_out', '')::date,
      NULLIF(p_stay->>'booking_reference', ''),
      v_stay_price,
      COALESCE(NULLIF(p_stay->>'price_currency', ''), 'INR'),
      NULLIF(p_stay->>'contact_phone', ''),
      NULLIF(p_stay->>'notes', '')
    FROM (SELECT 1) seed
    LEFT JOIN public.trip_days td
      ON td.ride_id = v_ride_id
     AND td.day_number = COALESCE(NULLIF(p_stay->>'day_number', '')::integer, 1)
    WHERE NULLIF(trim(p_stay->>'name'), '') IS NOT NULL;
  END IF;

  RETURN v_ride_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_trip_plan(JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip_plan(JSONB, JSONB, JSONB, JSONB) TO authenticated;

COMMIT;
