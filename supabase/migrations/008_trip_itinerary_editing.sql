-- Phase 1: transactional itinerary editing and repeatable accommodation records.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_trip_itinerary(
  p_ride_id UUID,
  p_waypoints JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_count INTEGER;
  v_payload_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = p_ride_id AND r.admin_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only the trip admin can edit the itinerary' USING ERRCODE = '42501';
  END IF;
  IF p_waypoints IS NULL OR jsonb_typeof(p_waypoints) <> 'array'
     OR jsonb_array_length(p_waypoints) > 200 THEN
    RAISE EXCEPTION 'Waypoints must be an array of at most 200 entries';
  END IF;

  SELECT count(*) INTO v_existing_count
  FROM public.trip_waypoints WHERE ride_id = p_ride_id;
  SELECT count(*) INTO v_payload_count
  FROM jsonb_to_recordset(p_waypoints) AS w(id UUID, sequence INTEGER, day_number INTEGER);

  IF v_existing_count <> v_payload_count THEN
    RAISE EXCEPTION 'The itinerary must include every existing waypoint';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_waypoints) AS w(id UUID, sequence INTEGER, day_number INTEGER)
    WHERE w.id IS NULL OR w.sequence IS NULL OR w.sequence < 0
       OR (w.day_number IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.trip_days d
         WHERE d.ride_id = p_ride_id AND d.day_number = w.day_number
       ))
  ) THEN
    RAISE EXCEPTION 'Invalid waypoint ID, sequence or trip day';
  END IF;
  IF (SELECT count(DISTINCT w.id) FROM jsonb_to_recordset(p_waypoints) AS w(id UUID, sequence INTEGER, day_number INTEGER)) <> v_payload_count
     OR (SELECT count(DISTINCT w.sequence) FROM jsonb_to_recordset(p_waypoints) AS w(id UUID, sequence INTEGER, day_number INTEGER)) <> v_payload_count
     OR EXISTS (
       SELECT 1 FROM jsonb_to_recordset(p_waypoints) AS w(id UUID, sequence INTEGER, day_number INTEGER)
       LEFT JOIN public.trip_waypoints tw ON tw.id = w.id AND tw.ride_id = p_ride_id
       WHERE tw.id IS NULL
     ) THEN
    RAISE EXCEPTION 'Itinerary contains duplicate or foreign waypoints/sequences';
  END IF;

  -- Move all rows out of the target sequence range first to avoid UNIQUE collisions during swaps.
  UPDATE public.trip_waypoints
  SET sequence = sequence + 1000000
  WHERE ride_id = p_ride_id;

  UPDATE public.trip_waypoints tw
  SET sequence = w.sequence,
      trip_day_id = td.id
  FROM jsonb_to_recordset(p_waypoints) AS w(id UUID, sequence INTEGER, day_number INTEGER)
  LEFT JOIN public.trip_days td
    ON td.ride_id = p_ride_id AND td.day_number = w.day_number
  WHERE tw.id = w.id AND tw.ride_id = p_ride_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_trip_stay(
  p_ride_id UUID,
  p_stay JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_day_id UUID;
  v_stay_id UUID;
  v_price NUMERIC;
  v_check_in DATE;
  v_check_out DATE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = p_ride_id AND r.admin_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only the trip admin can add accommodation' USING ERRCODE = '42501';
  END IF;
  IF p_stay IS NULL OR jsonb_typeof(p_stay) <> 'object'
     OR NULLIF(trim(p_stay->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Stay name is required';
  END IF;

  v_price := NULLIF(p_stay->>'price_amount', '')::NUMERIC;
  v_check_in := NULLIF(p_stay->>'check_in', '')::DATE;
  v_check_out := NULLIF(p_stay->>'check_out', '')::DATE;
  IF v_price < 0 THEN RAISE EXCEPTION 'Stay price cannot be negative'; END IF;
  IF v_check_in IS NOT NULL AND v_check_out IS NOT NULL AND v_check_out < v_check_in THEN
    RAISE EXCEPTION 'Stay check-out must be on or after check-in';
  END IF;

  IF NULLIF(p_stay->>'day_number', '') IS NOT NULL THEN
    SELECT id INTO v_day_id FROM public.trip_days
    WHERE ride_id = p_ride_id AND day_number = (p_stay->>'day_number')::INTEGER;
    IF v_day_id IS NULL THEN RAISE EXCEPTION 'Selected trip day does not exist'; END IF;
  END IF;

  INSERT INTO public.trip_stays (
    ride_id, trip_day_id, name, stay_type, address, latitude, longitude,
    provider_place_id, check_in, check_out, booking_reference,
    price_amount, price_currency, contact_phone, notes
  ) VALUES (
    p_ride_id, v_day_id, trim(p_stay->>'name'),
    COALESCE(NULLIF(p_stay->>'stay_type', ''), 'hotel'),
    NULLIF(p_stay->>'address', ''),
    NULLIF(p_stay->>'latitude', '')::DOUBLE PRECISION,
    NULLIF(p_stay->>'longitude', '')::DOUBLE PRECISION,
    NULLIF(p_stay->>'provider_place_id', ''),
    v_check_in, v_check_out, NULLIF(p_stay->>'booking_reference', ''),
    v_price, COALESCE(NULLIF(p_stay->>'price_currency', ''), 'INR'),
    NULLIF(p_stay->>'contact_phone', ''), NULLIF(p_stay->>'notes', '')
  ) RETURNING id INTO v_stay_id;

  RETURN v_stay_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_trip_itinerary(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_trip_itinerary(UUID, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.add_trip_stay(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_trip_stay(UUID, JSONB) TO authenticated;

COMMIT;
