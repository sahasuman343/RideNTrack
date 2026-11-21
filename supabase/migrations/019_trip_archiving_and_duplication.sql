-- Phase 1 Milestone: Trip Archiving & Deep Duplication
BEGIN;

-- 1. Support 'archived' status in rides table
ALTER TABLE public.rides
  DROP CONSTRAINT IF EXISTS rides_status_check;

ALTER TABLE public.rides
  ADD CONSTRAINT rides_status_check
  CHECK (status IN ('planned', 'active', 'completed', 'archived'));

-- 2. RPC: archive_trip
CREATE OR REPLACE FUNCTION public.archive_trip(p_ride_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the trip leader can archive this trip' USING ERRCODE = '42501';
  END IF;

  UPDATE public.rides
  SET status = 'archived'
  WHERE id = p_ride_id;
END;
$$;

-- 3. RPC: unarchive_trip
CREATE OR REPLACE FUNCTION public.unarchive_trip(p_ride_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the trip leader can unarchive this trip' USING ERRCODE = '42501';
  END IF;

  UPDATE public.rides
  SET status = 'planned'
  WHERE id = p_ride_id;
END;
$$;

-- 4. RPC: duplicate_trip
CREATE OR REPLACE FUNCTION public.duplicate_trip(
  p_ride_id UUID,
  p_new_name TEXT DEFAULT NULL,
  p_new_start_date DATE DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_source public.rides%ROWTYPE;
  v_new_ride_id UUID := gen_random_uuid();
  v_new_code TEXT;
  v_name TEXT;
  v_day_record RECORD;
  v_new_day_id UUID;
  v_stage_record RECORD;
  v_new_stage_id UUID;
  v_wp_record RECORD;
  v_stay_record RECORD;
  v_day_map JSONB := '{}'::jsonb;
  v_stage_map JSONB := '{}'::jsonb;
  v_date_offset INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_source FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source trip not found' USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller has access (admin or participant or public)
  IF v_source.admin_id != auth.uid()
     AND v_source.visibility != 'public'
     AND NOT public.is_ride_participant(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to duplicate this trip' USING ERRCODE = '42501';
  END IF;

  v_new_code := public.generate_ride_code();
  v_name := COALESCE(NULLIF(trim(p_new_name), ''), v_source.name || ' (Copy)');

  IF p_new_start_date IS NOT NULL AND v_source.start_date IS NOT NULL THEN
    v_date_offset := p_new_start_date - v_source.start_date;
  END IF;

  -- Insert cloned ride
  INSERT INTO public.rides (
    id, name, ride_code, admin_id, origin, destination,
    origin_coords, destination_coords, route_geometry, status,
    description, trip_type, visibility, start_date, end_date,
    estimated_distance_meters, estimated_duration_seconds,
    route_deviation_threshold_meters, rider_behind_threshold_meters, created_at
  ) VALUES (
    v_new_ride_id, v_name, v_new_code, auth.uid(), v_source.origin, v_source.destination,
    v_source.origin_coords, v_source.destination_coords, v_source.route_geometry, 'planned',
    v_source.description, v_source.trip_type, 'private',
    CASE WHEN p_new_start_date IS NOT NULL THEN p_new_start_date ELSE v_source.start_date END,
    CASE WHEN v_source.end_date IS NOT NULL AND v_date_offset != 0 THEN v_source.end_date + v_date_offset ELSE v_source.end_date END,
    v_source.estimated_distance_meters, v_source.estimated_duration_seconds,
    v_source.route_deviation_threshold_meters, v_source.rider_behind_threshold_meters, now()
  );

  -- Admin auto-join trigger handles participant creation for v_new_ride_id

  -- Clone trip_days
  FOR v_day_record IN SELECT * FROM public.trip_days WHERE ride_id = p_ride_id ORDER BY day_number LOOP
    v_new_day_id := gen_random_uuid();
    v_day_map := jsonb_set(v_day_map, ARRAY[v_day_record.id::text], to_jsonb(v_new_day_id::text));

    INSERT INTO public.trip_days (id, ride_id, day_number, trip_date, title, notes)
    VALUES (
      v_new_day_id, v_new_ride_id, v_day_record.day_number,
      CASE WHEN v_day_record.trip_date IS NOT NULL AND v_date_offset != 0 THEN v_day_record.trip_date + v_date_offset ELSE v_day_record.trip_date END,
      v_day_record.title, v_day_record.notes
    );
  END LOOP;

  -- Clone trip_stages
  FOR v_stage_record IN SELECT * FROM public.trip_stages WHERE ride_id = p_ride_id ORDER BY stage_number LOOP
    v_new_stage_id := gen_random_uuid();
    v_stage_map := jsonb_set(v_stage_map, ARRAY[v_stage_record.id::text], to_jsonb(v_new_stage_id::text));

    INSERT INTO public.trip_stages (
      id, ride_id, trip_day_id, stage_number, name, start_name, destination_name,
      start_coords, destination_coords, route_geometry, estimated_distance_meters,
      estimated_duration_seconds, notes, status, created_at
    ) VALUES (
      v_new_stage_id, v_new_ride_id,
      CASE WHEN v_stage_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_stage_record.trip_day_id::text)::uuid ELSE NULL END,
      v_stage_record.stage_number, v_stage_record.name, v_stage_record.start_name, v_stage_record.destination_name,
      v_stage_record.start_coords, v_stage_record.destination_coords, v_stage_record.route_geometry,
      v_stage_record.estimated_distance_meters, v_stage_record.estimated_duration_seconds,
      v_stage_record.notes, 'planned', now()
    );
  END LOOP;

  -- Clone trip_waypoints
  FOR v_wp_record IN SELECT * FROM public.trip_waypoints WHERE ride_id = p_ride_id ORDER BY sequence LOOP
    INSERT INTO public.trip_waypoints (
      id, ride_id, sequence, waypoint_type, name, address, latitude, longitude,
      provider_place_id, notes, is_optional, planned_arrival, planned_departure,
      trip_day_id, trip_stage_id
    ) VALUES (
      gen_random_uuid(), v_new_ride_id, v_wp_record.sequence, v_wp_record.waypoint_type,
      v_wp_record.name, v_wp_record.address, v_wp_record.latitude, v_wp_record.longitude,
      v_wp_record.provider_place_id, v_wp_record.notes, v_wp_record.is_optional,
      v_wp_record.planned_arrival, v_wp_record.planned_departure,
      CASE WHEN v_wp_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_wp_record.trip_day_id::text)::uuid ELSE NULL END,
      CASE WHEN v_wp_record.trip_stage_id IS NOT NULL THEN (v_stage_map->>v_wp_record.trip_stage_id::text)::uuid ELSE NULL END
    );
  END LOOP;

  -- Clone trip_stays
  FOR v_stay_record IN SELECT * FROM public.trip_stays WHERE ride_id = p_ride_id LOOP
    INSERT INTO public.trip_stays (
      id, ride_id, trip_day_id, name, stay_type, address, latitude, longitude,
      provider_place_id, check_in, check_out, booking_reference, price_amount,
      price_currency, contact_phone, notes
    ) VALUES (
      gen_random_uuid(), v_new_ride_id,
      CASE WHEN v_stay_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_stay_record.trip_day_id::text)::uuid ELSE NULL END,
      v_stay_record.name, v_stay_record.stay_type, v_stay_record.address, v_stay_record.latitude,
      v_stay_record.longitude, v_stay_record.provider_place_id, v_stay_record.check_in,
      v_stay_record.check_out, v_stay_record.booking_reference, v_stay_record.price_amount,
      v_stay_record.price_currency, v_stay_record.contact_phone, v_stay_record.notes
    );
  END LOOP;

  RETURN v_new_ride_id;
END;
$$;

-- Privileges
REVOKE EXECUTE ON FUNCTION public.archive_trip(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_trip(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.unarchive_trip(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unarchive_trip(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.duplicate_trip(UUID, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_trip(UUID, TEXT, DATE) TO authenticated;

COMMIT;
