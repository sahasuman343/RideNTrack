-- Migration: safety and access fixes from the codebase review and PR #13 review.
BEGIN;

-- 1. Chat: a sender may edit their own message, but never move it into
--    another ride or change who sent it.
DROP POLICY IF EXISTS "Ride messages updatable by sender or admin" ON public.ride_messages;
CREATE POLICY "Ride messages updatable by sender or admin" ON public.ride_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  )
  WITH CHECK (
    (
      sender_id = auth.uid()
      AND (
        public.is_ride_participant(ride_id, auth.uid())
        OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
      )
    )
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.keep_ride_message_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.ride_id IS DISTINCT FROM OLD.ride_id OR NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'A message cannot be moved to another ride or sender' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_ride_message_identity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS keep_ride_message_identity ON public.ride_messages;
CREATE TRIGGER keep_ride_message_identity BEFORE UPDATE OF ride_id, sender_id ON public.ride_messages
  FOR EACH ROW EXECUTE FUNCTION public.keep_ride_message_identity();

-- 2. Trip stages carry route geometry and notes: only members, the leader,
--    or anyone for a public trip may read them.
CREATE OR REPLACE FUNCTION public.get_trip_stages(p_ride_id UUID)
RETURNS TABLE (
  id UUID, ride_id UUID, trip_day_id UUID, day_number INTEGER, stage_number INTEGER,
  name TEXT, start_name TEXT, destination_name TEXT, start_coords JSONB, destination_coords JSONB,
  route_geometry JSONB, estimated_distance_meters INTEGER, estimated_duration_seconds INTEGER,
  notes TEXT, status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ts.id, ts.ride_id, ts.trip_day_id, td.day_number, ts.stage_number, ts.name,
    ts.start_name, ts.destination_name, ts.start_coords, ts.destination_coords, ts.route_geometry,
    ts.estimated_distance_meters, ts.estimated_duration_seconds, ts.notes, ts.status, ts.created_at
  FROM public.trip_stages ts
  LEFT JOIN public.trip_days td ON td.id = ts.trip_day_id
  WHERE ts.ride_id = p_ride_id
    AND auth.uid() IS NOT NULL
    AND (
      public.is_ride_participant(p_ride_id, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.rides r
        WHERE r.id = p_ride_id AND (r.admin_id = auth.uid() OR r.visibility = 'public')
      )
    )
  ORDER BY ts.stage_number ASC;
$$;
REVOKE ALL ON FUNCTION public.get_trip_stages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_stages(UUID) TO authenticated;

-- 3. SOS must never be blocked by GPS. An emergency may carry the last known
--    position (with its age) or no position at all; other alerts still need one.
ALTER TABLE public.alerts ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE public.alerts ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS location_recorded_at timestamptz;

DROP POLICY IF EXISTS "Members insert own alerts" ON public.alerts;
CREATE POLICY "Members insert own alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_ride_participant(ride_id, auth.uid())
    AND (
      (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
      OR (type = 'emergency' AND lat IS NULL AND lng IS NULL)
    )
    AND (location_recorded_at IS NULL OR location_recorded_at <= now() + interval '2 minutes')
    AND (
      type IS DISTINCT FROM 'announcement'
      OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
    )
  );

-- 4. Breadcrumbs: skip points that cannot be real (future clocks, impossible
--    speeds) instead of storing them as a rider's "latest" position. The batch
--    still acknowledges every row so the device does not retry bad points forever.
CREATE OR REPLACE FUNCTION public.bulk_insert_location_updates(updates jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR updates IS NULL OR jsonb_typeof(updates) != 'array' THEN
    RAISE EXCEPTION 'Invalid location batch';
  END IF;
  IF jsonb_array_length(updates) > 100 THEN RAISE EXCEPTION 'Batch exceeds 100 records'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(updates) item WHERE
    (item->>'user_id')::uuid IS DISTINCT FROM auth.uid()
    OR NOT coalesce(public.is_ride_participant((item->>'ride_id')::uuid, auth.uid()), false)
    OR item->>'client_id' IS NULL OR item->>'timestamp' IS NULL
    OR item->>'lat' IS NULL OR item->>'lng' IS NULL
    OR NOT ((item->>'lat')::double precision BETWEEN -90 AND 90)
    OR NOT ((item->>'lng')::double precision BETWEEN -180 AND 180)) THEN
    RAISE EXCEPTION 'Invalid or unauthorized location batch';
  END IF;
  INSERT INTO public.location_updates (client_id, ride_id, user_id, lat, lng, speed, heading, timestamp)
  SELECT (item->>'client_id')::uuid, (item->>'ride_id')::uuid, auth.uid(),
    (item->>'lat')::double precision, (item->>'lng')::double precision,
    least(greatest(coalesce((item->>'speed')::double precision, 0), 0), 120),
    mod(mod(coalesce((item->>'heading')::double precision, 0)::numeric, 360) + 360, 360)::double precision,
    (item->>'timestamp')::timestamptz
  FROM jsonb_array_elements(updates) item
  WHERE (item->>'timestamp')::timestamptz <= now() + interval '2 minutes'
    AND coalesce((item->>'speed')::double precision, 0) <= 120
  ON CONFLICT (client_id) DO NOTHING;
  RETURN jsonb_array_length(updates);
END; $$;
REVOKE ALL ON FUNCTION public.bulk_insert_location_updates(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_insert_location_updates(jsonb) TO authenticated;

-- 5. Latest position per active rider without scanning the ride's whole
--    history: one index lookup per participant.
CREATE OR REPLACE FUNCTION public.get_latest_ride_locations(p_ride_id uuid)
RETURNS TABLE(user_id uuid, display_name text, lat double precision, lng double precision,
  speed double precision, heading double precision, "timestamp" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT rp.user_id, p.display_name, l.lat, l.lng, l.speed, l.heading, l.timestamp
  FROM public.ride_participants rp
  JOIN public.profiles p ON p.id = rp.user_id
  CROSS JOIN LATERAL (
    SELECT lu.lat, lu.lng, lu.speed, lu.heading, lu.timestamp
    FROM public.location_updates lu
    WHERE lu.ride_id = rp.ride_id AND lu.user_id = rp.user_id
    ORDER BY lu.timestamp DESC
    LIMIT 1
  ) l
  WHERE rp.ride_id = p_ride_id AND rp.is_active
    AND public.is_ride_participant(p_ride_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_latest_ride_locations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_ride_locations(uuid) TO authenticated;

-- 6. Spectator link tokens are generated by the database (two random UUIDs,
--    ~244 bits) instead of Math.random() on the phone.
ALTER TABLE public.ride_share_links
  ALTER COLUMN token SET DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

-- 7. Pack fuel plan: every active rider's bike range, visible only to the
--    ride's members. Profiles stay private; only the three fuel numbers leave.
CREATE OR REPLACE FUNCTION public.get_ride_fuel_specs(p_ride_id uuid)
RETURNS TABLE(user_id uuid, display_name text, fuel_tank_capacity_liters numeric,
  mileage_km_per_liter numeric, fuel_reserve_liters numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT rp.user_id, p.display_name, p.fuel_tank_capacity_liters, p.mileage_km_per_liter, p.fuel_reserve_liters
  FROM public.ride_participants rp
  JOIN public.profiles p ON p.id = rp.user_id
  WHERE rp.ride_id = p_ride_id AND rp.is_active
    AND (
      public.is_ride_participant(p_ride_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = p_ride_id AND r.admin_id = auth.uid())
    );
$$;
REVOKE ALL ON FUNCTION public.get_ride_fuel_specs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_fuel_specs(uuid) TO authenticated;

COMMIT;
