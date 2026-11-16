-- Full route editing: update the ride route and its ordered waypoint set atomically.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_trip_route(
  p_ride_id UUID,
  p_trip JSONB,
  p_waypoints JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_point RECORD;
  v_day_id UUID;
  v_seen INTEGER := 0;
  v_total INTEGER;
  v_existing_ids UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r WHERE r.id = p_ride_id AND r.admin_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only the trip admin can edit the route' USING ERRCODE = '42501';
  END IF;
  IF p_trip IS NULL OR jsonb_typeof(p_trip) <> 'object' THEN
    RAISE EXCEPTION 'Route details must be an object';
  END IF;
  IF p_waypoints IS NULL OR jsonb_typeof(p_waypoints) <> 'array'
     OR jsonb_array_length(p_waypoints) < 2 OR jsonb_array_length(p_waypoints) > 200 THEN
    RAISE EXCEPTION 'A route must contain between 2 and 200 points';
  END IF;

  v_total := jsonb_array_length(p_waypoints);
  IF NULLIF(trim(p_trip->>'origin'), '') IS NULL
     OR NULLIF(trim(p_trip->>'destination'), '') IS NULL
     OR jsonb_typeof(p_trip->'origin_coords') <> 'array'
     OR jsonb_array_length(p_trip->'origin_coords') <> 2
     OR jsonb_typeof(p_trip->'destination_coords') <> 'array'
     OR jsonb_array_length(p_trip->'destination_coords') <> 2 THEN
    RAISE EXCEPTION 'Origin, destination and coordinates are required';
  END IF;
  IF NULLIF(p_trip->>'estimated_distance_meters', '') IS NOT NULL
     AND (p_trip->>'estimated_distance_meters')::integer < 0 THEN
    RAISE EXCEPTION 'Route distance cannot be negative';
  END IF;
  IF NULLIF(p_trip->>'estimated_duration_seconds', '') IS NOT NULL
     AND (p_trip->>'estimated_duration_seconds')::integer < 0 THEN
    RAISE EXCEPTION 'Route duration cannot be negative';
  END IF;
  IF p_trip->'route_geometry' IS NOT NULL AND p_trip->'route_geometry' <> 'null'::jsonb
     AND (p_trip->'route_geometry'->'geometry'->>'type' <> 'LineString'
       OR jsonb_typeof(p_trip->'route_geometry'->'geometry'->'coordinates') <> 'array') THEN
    RAISE EXCEPTION 'Route geometry must be a GeoJSON LineString';
  END IF;

  IF (p_waypoints->0->>'waypoint_type') <> 'origin'
     OR (p_waypoints->(v_total - 1)->>'waypoint_type') <> 'destination' THEN
    RAISE EXCEPTION 'The first route point must be origin and the last must be destination';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_waypoints) AS w(
      id UUID, sequence INTEGER, waypoint_type TEXT, name TEXT, address TEXT,
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, provider_place_id TEXT,
      notes TEXT, is_optional BOOLEAN, day_number INTEGER
    )
    WHERE w.sequence IS NULL OR w.sequence < 0
       OR NULLIF(trim(w.name), '') IS NULL
       OR w.latitude IS NULL OR w.latitude NOT BETWEEN -90 AND 90
       OR w.longitude IS NULL OR w.longitude NOT BETWEEN -180 AND 180
       OR w.waypoint_type NOT IN ('origin','meetup','stop','fuel','food','rest','sightseeing','destination')
       OR (w.day_number IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.trip_days d WHERE d.ride_id = p_ride_id AND d.day_number = w.day_number
       ))
  ) THEN
    RAISE EXCEPTION 'A route point has invalid coordinates, name, type or trip day';
  END IF;
  IF (SELECT count(DISTINCT w.sequence) FROM jsonb_to_recordset(p_waypoints) AS w(sequence INTEGER)) <> v_total
     OR (SELECT count(DISTINCT w.id) FROM jsonb_to_recordset(p_waypoints) AS w(id UUID)) FILTER (WHERE w.id IS NOT NULL) > v_total THEN
    RAISE EXCEPTION 'Route point sequences and IDs must be unique';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_waypoints) AS w(sequence INTEGER)
    WHERE w.sequence >= v_total
  ) THEN
    RAISE EXCEPTION 'Route point sequences must be contiguous starting at zero';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_waypoints) AS w(id UUID)
    WHERE w.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.trip_waypoints tw WHERE tw.id = w.id AND tw.ride_id = p_ride_id
    )
  ) THEN
    RAISE EXCEPTION 'Route contains a waypoint from another trip';
  END IF;

  -- Temporarily move current sequence values to avoid collisions while the route is reordered.
  UPDATE public.trip_waypoints SET sequence = sequence + 1000000 WHERE ride_id = p_ride_id;

  FOR v_point IN
    SELECT * FROM jsonb_to_recordset(p_waypoints) AS w(
      id UUID, sequence INTEGER, waypoint_type TEXT, name TEXT, address TEXT,
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, provider_place_id TEXT,
      notes TEXT, is_optional BOOLEAN, day_number INTEGER
    ) ORDER BY sequence
  LOOP
    v_day_id := NULL;
    IF v_point.day_number IS NOT NULL THEN
      SELECT d.id INTO v_day_id FROM public.trip_days d
      WHERE d.ride_id = p_ride_id AND d.day_number = v_point.day_number;
    END IF;

    IF v_point.id IS NULL THEN
      INSERT INTO public.trip_waypoints(
        ride_id, sequence, waypoint_type, name, address, latitude, longitude,
        provider_place_id, notes, is_optional, trip_day_id
      ) VALUES (
        p_ride_id, v_point.sequence, v_point.waypoint_type, trim(v_point.name),
        NULLIF(trim(v_point.address), ''), v_point.latitude, v_point.longitude,
        NULLIF(v_point.provider_place_id, ''), NULLIF(v_point.notes, ''),
        COALESCE(v_point.is_optional, false), v_day_id
      );
    ELSE
      UPDATE public.trip_waypoints SET
        sequence = v_point.sequence, waypoint_type = v_point.waypoint_type,
        name = trim(v_point.name), address = NULLIF(trim(v_point.address), ''),
        latitude = v_point.latitude, longitude = v_point.longitude,
        provider_place_id = NULLIF(v_point.provider_place_id, ''),
        notes = NULLIF(v_point.notes, ''), is_optional = COALESCE(v_point.is_optional, false),
        trip_day_id = v_day_id
      WHERE id = v_point.id AND ride_id = p_ride_id;
    END IF;
    v_seen := v_seen + 1;
  END LOOP;

  DELETE FROM public.trip_waypoints tw
  WHERE tw.ride_id = p_ride_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_waypoints) AS w(id UUID)
      WHERE w.id = tw.id
    );

  UPDATE public.rides SET
    origin = trim(p_trip->>'origin'),
    destination = trim(p_trip->>'destination'),
    origin_coords = p_trip->'origin_coords',
    destination_coords = p_trip->'destination_coords',
    route_geometry = CASE WHEN p_trip->'route_geometry' = 'null'::jsonb THEN NULL ELSE p_trip->'route_geometry' END,
    estimated_distance_meters = NULLIF(p_trip->>'estimated_distance_meters', '')::integer,
    estimated_duration_seconds = NULLIF(p_trip->>'estimated_duration_seconds', '')::integer
  WHERE id = p_ride_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_trip_route(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_trip_route(UUID, JSONB, JSONB) TO authenticated;

COMMIT;
