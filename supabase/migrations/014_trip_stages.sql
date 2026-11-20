-- Milestone 2: Touring Planner - Multi-day Itineraries, Stages & Waypoint Categories
BEGIN;

-- 1. Expand waypoint categories to include repair and accommodation
ALTER TABLE public.trip_waypoints
  DROP CONSTRAINT IF EXISTS trip_waypoints_waypoint_type_check;

ALTER TABLE public.trip_waypoints
  ADD CONSTRAINT trip_waypoints_waypoint_type_check
  CHECK (waypoint_type IN ('origin','meetup','stop','fuel','food','rest','sightseeing','destination','repair','accommodation'));

-- 2. Create trip_stages table
CREATE TABLE IF NOT EXISTS public.trip_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  trip_day_id UUID REFERENCES public.trip_days(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL CHECK (stage_number > 0),
  name TEXT NOT NULL,
  start_name TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  start_coords JSONB NOT NULL,
  destination_coords JSONB NOT NULL,
  route_geometry JSONB,
  estimated_distance_meters INTEGER CHECK (estimated_distance_meters IS NULL OR estimated_distance_meters >= 0),
  estimated_duration_seconds INTEGER CHECK (estimated_duration_seconds IS NULL OR estimated_duration_seconds >= 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, stage_number)
);

CREATE INDEX IF NOT EXISTS idx_trip_stages_ride_stage ON public.trip_stages(ride_id, stage_number);
CREATE INDEX IF NOT EXISTS idx_trip_stages_day ON public.trip_stages(trip_day_id);

-- 3. Associate waypoints with optional stage
ALTER TABLE public.trip_waypoints
  ADD COLUMN IF NOT EXISTS trip_stage_id UUID REFERENCES public.trip_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trip_waypoints_stage ON public.trip_waypoints(trip_stage_id);

-- 4. RLS Policies on trip_stages
ALTER TABLE public.trip_stages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Trip stages visible to ride members" ON public.trip_stages
    FOR SELECT USING (public.is_ride_participant(ride_id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Ride admins manage trip stages" ON public.trip_stages
    FOR ALL USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. RPC: save_trip_stage
CREATE OR REPLACE FUNCTION public.save_trip_stage(
  p_ride_id UUID,
  p_stage JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_stage_id UUID;
  v_day_id UUID := NULL;
  v_day_num INTEGER;
  v_stage_num INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r WHERE r.id = p_ride_id AND r.admin_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only the trip leader can manage stages' USING ERRCODE = '42501';
  END IF;
  IF p_stage IS NULL OR jsonb_typeof(p_stage) <> 'object' THEN
    RAISE EXCEPTION 'Stage details must be an object';
  END IF;
  IF NULLIF(trim(p_stage->>'name'), '') IS NULL
     OR NULLIF(trim(p_stage->>'start_name'), '') IS NULL
     OR NULLIF(trim(p_stage->>'destination_name'), '') IS NULL
     OR jsonb_typeof(p_stage->'start_coords') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_stage->'start_coords') <> 2
     OR jsonb_typeof(p_stage->'destination_coords') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_stage->'destination_coords') <> 2 THEN
    RAISE EXCEPTION 'Stage name, start name, destination name and coordinates are required';
  END IF;

  -- Resolve day ID if day_number is provided
  IF NULLIF(p_stage->>'day_number', '') IS NOT NULL THEN
    v_day_num := (p_stage->>'day_number')::integer;
    SELECT id INTO v_day_id
    FROM public.trip_days
    WHERE ride_id = p_ride_id AND day_number = v_day_num;
  ELSIF NULLIF(p_stage->>'trip_day_id', '') IS NOT NULL THEN
    v_day_id := (p_stage->>'trip_day_id')::uuid;
  END IF;

  -- Determine stage number
  IF NULLIF(p_stage->>'stage_number', '') IS NOT NULL THEN
    v_stage_num := (p_stage->>'stage_number')::integer;
  ELSE
    SELECT COALESCE(MAX(stage_number), 0) + 1 INTO v_stage_num
    FROM public.trip_stages
    WHERE ride_id = p_ride_id;
  END IF;

  IF NULLIF(p_stage->>'id', '') IS NOT NULL THEN
    v_stage_id := (p_stage->>'id')::uuid;
    UPDATE public.trip_stages
    SET
      trip_day_id = v_day_id,
      name = trim(p_stage->>'name'),
      start_name = trim(p_stage->>'start_name'),
      destination_name = trim(p_stage->>'destination_name'),
      start_coords = p_stage->'start_coords',
      destination_coords = p_stage->'destination_coords',
      route_geometry = p_stage->'route_geometry',
      estimated_distance_meters = NULLIF(p_stage->>'estimated_distance_meters', '')::integer,
      estimated_duration_seconds = NULLIF(p_stage->>'estimated_duration_seconds', '')::integer,
      notes = NULLIF(trim(p_stage->>'notes'), ''),
      status = COALESCE(NULLIF(p_stage->>'status', ''), status)
    WHERE id = v_stage_id AND ride_id = p_ride_id;
  ELSE
    INSERT INTO public.trip_stages (
      ride_id, trip_day_id, stage_number, name, start_name, destination_name,
      start_coords, destination_coords, route_geometry,
      estimated_distance_meters, estimated_duration_seconds, notes, status
    ) VALUES (
      p_ride_id,
      v_day_id,
      v_stage_num,
      trim(p_stage->>'name'),
      trim(p_stage->>'start_name'),
      trim(p_stage->>'destination_name'),
      p_stage->'start_coords',
      p_stage->'destination_coords',
      p_stage->'route_geometry',
      NULLIF(p_stage->>'estimated_distance_meters', '')::integer,
      NULLIF(p_stage->>'estimated_duration_seconds', '')::integer,
      NULLIF(trim(p_stage->>'notes'), ''),
      COALESCE(NULLIF(p_stage->>'status', ''), 'planned')
    )
    RETURNING id INTO v_stage_id;
  END IF;

  RETURN v_stage_id;
END;
$$;

-- 6. RPC: delete_trip_stage
CREATE OR REPLACE FUNCTION public.delete_trip_stage(
  p_ride_id UUID,
  p_stage_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_stage_rec RECORD;
  v_counter INTEGER := 1;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r WHERE r.id = p_ride_id AND r.admin_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only the trip leader can delete stages' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.trip_stages
  WHERE id = p_stage_id AND ride_id = p_ride_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage not found' USING ERRCODE = 'P0002';
  END IF;

  -- Renumber remaining stages contiguously
  FOR v_stage_rec IN
    SELECT id FROM public.trip_stages
    WHERE ride_id = p_ride_id
    ORDER BY stage_number ASC
  LOOP
    UPDATE public.trip_stages
    SET stage_number = v_counter
    WHERE id = v_stage_rec.id;
    v_counter := v_counter + 1;
  END LOOP;
END;
$$;

-- 7. RPC: update_stage_status
CREATE OR REPLACE FUNCTION public.update_stage_status(
  p_stage_id UUID,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ride_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_status NOT IN ('planned', 'in_progress', 'completed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid stage status: %', p_status;
  END IF;

  SELECT ride_id INTO v_ride_id
  FROM public.trip_stages
  WHERE id = p_stage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_ride_participant(v_ride_id, v_user_id) THEN
    RAISE EXCEPTION 'Only trip participants can update stage status' USING ERRCODE = '42501';
  END IF;

  UPDATE public.trip_stages
  SET status = p_status
  WHERE id = p_stage_id;
END;
$$;

-- 8. RPC: get_trip_stages
CREATE OR REPLACE FUNCTION public.get_trip_stages(p_ride_id UUID)
RETURNS TABLE (
  id UUID,
  ride_id UUID,
  trip_day_id UUID,
  day_number INTEGER,
  stage_number INTEGER,
  name TEXT,
  start_name TEXT,
  destination_name TEXT,
  start_coords JSONB,
  destination_coords JSONB,
  route_geometry JSONB,
  estimated_distance_meters INTEGER,
  estimated_duration_seconds INTEGER,
  notes TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    ts.id,
    ts.ride_id,
    ts.trip_day_id,
    td.day_number,
    ts.stage_number,
    ts.name,
    ts.start_name,
    ts.destination_name,
    ts.start_coords,
    ts.destination_coords,
    ts.route_geometry,
    ts.estimated_distance_meters,
    ts.estimated_duration_seconds,
    ts.notes,
    ts.status,
    ts.created_at
  FROM public.trip_stages ts
  LEFT JOIN public.trip_days td ON td.id = ts.trip_day_id
  WHERE ts.ride_id = p_ride_id
  ORDER BY ts.stage_number ASC;
$$;

-- 9. Update save_trip_route to support new waypoint categories
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
  v_waypoint_id UUID;
  v_keep_ids UUID[] := ARRAY[]::UUID[];
  v_total INTEGER;
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
     OR jsonb_typeof(p_trip->'origin_coords') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_trip->'origin_coords') <> 2
     OR jsonb_typeof(p_trip->'destination_coords') IS DISTINCT FROM 'array'
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
     AND (p_trip->'route_geometry'->'geometry'->>'type' IS DISTINCT FROM 'LineString'
       OR jsonb_typeof(p_trip->'route_geometry'->'geometry'->'coordinates') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_trip->'route_geometry'->'geometry'->'coordinates') < 2) THEN
    RAISE EXCEPTION 'Route geometry must be a GeoJSON LineString';
  END IF;

  IF (p_waypoints->0->>'waypoint_type') <> 'origin'
     OR (p_waypoints->(v_total - 1)->>'waypoint_type') <> 'destination'
     OR (SELECT count(*) FROM jsonb_to_recordset(p_waypoints) AS w(waypoint_type TEXT) WHERE w.waypoint_type='origin') <> 1
     OR (SELECT count(*) FROM jsonb_to_recordset(p_waypoints) AS w(waypoint_type TEXT) WHERE w.waypoint_type='destination') <> 1 THEN
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
       OR w.waypoint_type NOT IN ('origin','meetup','stop','fuel','food','rest','sightseeing','destination','repair','accommodation')
       OR (w.day_number IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.trip_days d WHERE d.ride_id = p_ride_id AND d.day_number = w.day_number
       ))
  ) THEN
    RAISE EXCEPTION 'A route point has invalid coordinates, name, type or trip day';
  END IF;
  IF (SELECT count(DISTINCT w.sequence) FROM jsonb_to_recordset(p_waypoints) AS w(sequence INTEGER)) <> v_total
     OR (SELECT count(*) FROM jsonb_to_recordset(p_waypoints) AS w(id UUID) WHERE w.id IS NOT NULL)
        <> (SELECT count(DISTINCT w.id) FROM jsonb_to_recordset(p_waypoints) AS w(id UUID) WHERE w.id IS NOT NULL) THEN
    RAISE EXCEPTION 'Route point sequences and IDs must be unique';
  END IF;

  UPDATE public.rides
  SET origin = trim(p_trip->>'origin'),
      destination = trim(p_trip->>'destination'),
      origin_coords = p_trip->'origin_coords',
      destination_coords = p_trip->'destination_coords',
      route_geometry = p_trip->'route_geometry',
      estimated_distance_meters = NULLIF(p_trip->>'estimated_distance_meters', '')::integer,
      estimated_duration_seconds = NULLIF(p_trip->>'estimated_duration_seconds', '')::integer
  WHERE id = p_ride_id;

  UPDATE public.trip_waypoints
  SET sequence = sequence + 1000000
  WHERE ride_id = p_ride_id;

  FOR v_point IN
    SELECT
      w.id,
      w.sequence,
      w.waypoint_type,
      trim(w.name) AS name,
      NULLIF(trim(w.address), '') AS address,
      w.latitude,
      w.longitude,
      NULLIF(trim(w.provider_place_id), '') AS provider_place_id,
      NULLIF(trim(w.notes), '') AS notes,
      COALESCE(w.is_optional, false) AS is_optional,
      w.day_number
    FROM jsonb_to_recordset(p_waypoints) AS w(
      id UUID, sequence INTEGER, waypoint_type TEXT, name TEXT, address TEXT,
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, provider_place_id TEXT,
      notes TEXT, is_optional BOOLEAN, day_number INTEGER
    )
    ORDER BY w.sequence ASC
  LOOP
    v_day_id := NULL;
    IF v_point.day_number IS NOT NULL THEN
      SELECT d.id INTO v_day_id FROM public.trip_days d
      WHERE d.ride_id = p_ride_id AND d.day_number = v_point.day_number;
    END IF;

    IF v_point.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.trip_waypoints tw WHERE tw.id = v_point.id AND tw.ride_id = p_ride_id
    ) THEN
      UPDATE public.trip_waypoints
      SET sequence = v_point.sequence,
          waypoint_type = v_point.waypoint_type,
          name = v_point.name,
          address = COALESCE(v_point.address, v_point.name),
          latitude = v_point.latitude,
          longitude = v_point.longitude,
          provider_place_id = v_point.provider_place_id,
          notes = v_point.notes,
          is_optional = v_point.is_optional,
          trip_day_id = v_day_id
      WHERE id = v_point.id AND ride_id = p_ride_id;
      v_keep_ids := array_append(v_keep_ids, v_point.id);
    ELSE
      INSERT INTO public.trip_waypoints (
        ride_id, sequence, waypoint_type, name, address,
        latitude, longitude, provider_place_id, notes, is_optional, trip_day_id
      ) VALUES (
        p_ride_id, v_point.sequence, v_point.waypoint_type, v_point.name,
        COALESCE(v_point.address, v_point.name), v_point.latitude, v_point.longitude,
        v_point.provider_place_id, v_point.notes, v_point.is_optional, v_day_id
      )
      RETURNING id INTO v_waypoint_id;
      v_keep_ids := array_append(v_keep_ids, v_waypoint_id);
    END IF;
  END LOOP;

  DELETE FROM public.trip_waypoints
  WHERE ride_id = p_ride_id AND id <> ALL(v_keep_ids);
END;
$$;

-- 10. Grant privileges
REVOKE ALL ON FUNCTION public.save_trip_stage(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_trip_stage(UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_trip_stage(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_trip_stage(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.update_stage_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_stage_status(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_trip_stages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_stages(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.save_trip_route(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_trip_route(UUID, JSONB, JSONB) TO authenticated;

COMMIT;
