-- Apply before deploying the updated clients. Existing history is preserved.
BEGIN;
ALTER TABLE public.location_updates ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS location_updates_client_id_key ON public.location_updates(client_id);
CREATE OR REPLACE FUNCTION public.is_ride_participant(p_ride_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.ride_participants
    WHERE ride_id = p_ride_id AND user_id = p_user_id AND is_active);
$$;
REVOKE ALL ON FUNCTION public.is_ride_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ride_participant(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Read own private profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS "Users can join rides" ON public.ride_participants;
CREATE OR REPLACE FUNCTION public.auto_join_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.ride_participants (ride_id, user_id) VALUES (NEW.id, NEW.admin_id);
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.join_ride_by_code(p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ride_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to join a ride'; END IF;
  SELECT id INTO v_ride_id FROM public.rides WHERE ride_code = upper(trim(p_code)) AND status != 'completed';
  IF v_ride_id IS NULL THEN RAISE EXCEPTION 'Invalid ride code or ride has ended'; END IF;
  INSERT INTO public.ride_participants (ride_id, user_id) VALUES (v_ride_id, auth.uid())
    ON CONFLICT (ride_id, user_id) DO UPDATE SET is_active = true;
  RETURN v_ride_id;
END; $$;
REVOKE ALL ON FUNCTION public.join_ride_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_ride_by_code(text) TO authenticated;
DROP POLICY IF EXISTS "Users can insert own location" ON public.location_updates;
CREATE POLICY "Members insert own location" ON public.location_updates FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_ride_participant(ride_id, auth.uid())
    AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);
DROP POLICY IF EXISTS "Participants can create alerts" ON public.alerts;
CREATE POLICY "Members insert own alerts" ON public.alerts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_ride_participant(ride_id, auth.uid())
    AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180);

CREATE OR REPLACE FUNCTION public.get_ride_members(p_ride_id uuid)
RETURNS TABLE(user_id uuid, display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.display_name FROM public.profiles p JOIN public.ride_participants rp ON rp.user_id = p.id
  WHERE rp.ride_id = p_ride_id AND rp.is_active AND public.is_ride_participant(p_ride_id, auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.get_latest_ride_locations(p_ride_id uuid)
RETURNS TABLE(user_id uuid, display_name text, lat double precision, lng double precision,
  speed double precision, heading double precision, "timestamp" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT ON (l.user_id) l.user_id, p.display_name, l.lat, l.lng, l.speed, l.heading, l.timestamp
  FROM public.location_updates l JOIN public.profiles p ON p.id = l.user_id
  JOIN public.ride_participants rp ON rp.ride_id = l.ride_id AND rp.user_id = l.user_id
  WHERE l.ride_id = p_ride_id AND rp.is_active AND public.is_ride_participant(p_ride_id, auth.uid())
  ORDER BY l.user_id, l.timestamp DESC;
$$;
REVOKE ALL ON FUNCTION public.get_ride_members(uuid), public.get_latest_ride_locations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ride_members(uuid), public.get_latest_ride_locations(uuid) TO authenticated;

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
    greatest(coalesce((item->>'speed')::double precision, 0), 0),
    coalesce((item->>'heading')::double precision, 0), (item->>'timestamp')::timestamptz
  FROM jsonb_array_elements(updates) item ON CONFLICT (client_id) DO NOTHING;
  RETURN jsonb_array_length(updates);
END; $$;
REVOKE ALL ON FUNCTION public.bulk_insert_location_updates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_insert_location_updates(jsonb) TO authenticated;

CREATE POLICY "Members receive ride presence" ON realtime.messages FOR SELECT TO authenticated
USING (extension = 'presence' AND EXISTS (
  SELECT 1 FROM public.ride_participants WHERE user_id = auth.uid() AND is_active
    AND realtime.topic() = 'ride:' || ride_id::text));
CREATE POLICY "Members publish ride presence" ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (extension = 'presence' AND EXISTS (
  SELECT 1 FROM public.ride_participants WHERE user_id = auth.uid() AND is_active
    AND realtime.topic() = 'ride:' || ride_id::text));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alerts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rides') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
  END IF;
END $$;
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.generate_ride_code() SET search_path = '';
ALTER FUNCTION public.set_ride_code() SET search_path = 'public';
COMMIT;
