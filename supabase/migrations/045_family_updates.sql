-- F2 Family auto-updates. Riders add up to two family contacts with consent.
-- The server notices three events and queues one plain SMS each (through the
-- outbound queue, which caps and dedupes): ride started, reached the night's
-- stay, and an unanswered check-in. Each message carries a family link to the
-- spectator page. Decision 3: family links are free during a live ride
-- (flag free_safety_features), so they no longer need Pro.
BEGIN;

CREATE TABLE IF NOT EXISTS public.family_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  relation text CHECK (relation IS NULL OR char_length(relation) <= 30),
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'whatsapp')),
  paused boolean NOT NULL DEFAULT false,
  consent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_family_contacts_user ON public.family_contacts (user_id) WHERE NOT paused;
ALTER TABLE public.family_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_contacts FROM anon;
DROP POLICY IF EXISTS family_contacts_own_read ON public.family_contacts;
CREATE POLICY family_contacts_own_read ON public.family_contacts FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.save_family_contact(p_id uuid, p_name text, p_phone text, p_relation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF p_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Enter the number with country code, e.g. +91 98765 43210' USING ERRCODE = '22023'; END IF;
  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.family_contacts WHERE user_id = auth.uid()) >= 2 THEN
      RAISE EXCEPTION 'You can add up to two family contacts' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.family_contacts (user_id, name, phone, relation)
    VALUES (auth.uid(), trim(p_name), p_phone, nullif(trim(p_relation), ''))
    ON CONFLICT (user_id, phone) DO UPDATE SET name = EXCLUDED.name, relation = EXCLUDED.relation, consent_at = now()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.family_contacts SET name = trim(p_name), phone = p_phone, relation = nullif(trim(p_relation), ''), consent_at = now()
     WHERE id = p_id AND user_id = auth.uid() RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Contact not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_family_contact(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.family_contacts WHERE id = p_id AND user_id = auth.uid();
$$;

-- Pause or resume updates for all of this rider's contacts (e.g. a solo detour).
CREATE OR REPLACE FUNCTION public.set_family_updates_paused(p_paused boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  UPDATE public.family_contacts SET paused = p_paused WHERE user_id = auth.uid();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Family links -----------------------------------------------------------------
ALTER TABLE public.ride_share_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'share' CHECK (kind IN ('share', 'family')),
  ADD COLUMN IF NOT EXISTS subject_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.flag_enabled(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT enabled AND rollout_percent = 100 FROM public.app_flags WHERE key = p_key), false);
$$;

CREATE OR REPLACE FUNCTION public.public_track_url(p_token text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'https://ridentrack.app/track/' || p_token; $$;

-- Server-side: the current family link for a rider on a ride, created if needed.
CREATE OR REPLACE FUNCTION public.family_link_token(p_ride_id uuid, p_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
  SELECT token INTO v_token FROM public.ride_share_links
   WHERE ride_id = p_ride_id AND subject_user_id = p_user_id AND kind = 'family'
     AND revoked_at IS NULL AND expires_at > now() + interval '6 hours'
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NULL THEN
    INSERT INTO public.ride_share_links (ride_id, created_by, expires_at, kind, subject_user_id)
    VALUES (p_ride_id, p_user_id, now() + interval '72 hours', 'family', p_user_id)
    RETURNING token INTO v_token;
  END IF;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.family_link_token(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Any member can share their own family link while the ride is planned or live:
-- free when free_safety_features is on, otherwise it needs Pro on the ride.
CREATE OR REPLACE FUNCTION public.create_family_link(p_ride_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF public.ride_member_role(p_ride_id, auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501'; END IF;
  SELECT status INTO v_status FROM public.rides WHERE id = p_ride_id;
  IF v_status NOT IN ('planned', 'active') THEN RAISE EXCEPTION 'This ride has ended' USING ERRCODE = '22023'; END IF;
  IF NOT (public.flag_enabled('free_safety_features') OR public.ride_has_pro_access(p_ride_id)) THEN
    RAISE EXCEPTION 'Family links need Pro Tourer or an Expedition Pass' USING ERRCODE = '42501';
  END IF;
  RETURN public.family_link_token(p_ride_id, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_my_family_links(p_ride_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.ride_share_links SET revoked_at = now()
   WHERE ride_id = p_ride_id AND subject_user_id = auth.uid() AND kind = 'family' AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Event fan-out ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_family(p_ride_id uuid, p_user_id uuid, p_template text, p_vars jsonb, p_event_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_rider text; v_ride text; v_link text; v_n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.family_contacts WHERE user_id = p_user_id AND NOT paused) THEN RETURN 0; END IF;
  SELECT coalesce(display_name, 'Your rider') INTO v_rider FROM public.profiles WHERE id = p_user_id;
  SELECT name INTO v_ride FROM public.rides WHERE id = p_ride_id;
  v_link := public.public_track_url(public.family_link_token(p_ride_id, p_user_id));
  FOR c IN SELECT * FROM public.family_contacts WHERE user_id = p_user_id AND NOT paused LOOP
    PERFORM public.enqueue_outbound_message(
      p_ride_id, p_user_id, c.phone, p_template,
      jsonb_build_object('rider', v_rider, 'ride', v_ride, 'link', v_link) || coalesce(p_vars, '{}'::jsonb),
      p_event_key || ':' || c.id::text, c.channel, c.name);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_family(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- 1. Ride started.
CREATE OR REPLACE FUNCTION public.family_on_ride_started()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    FOR r IN SELECT user_id FROM public.ride_participants
              WHERE ride_id = NEW.id AND is_active AND attendance_status NOT IN ('absent', 'declined') LOOP
      PERFORM public.notify_family(NEW.id, r.user_id, 'family_ride_started', '{}'::jsonb, 'family_start:' || NEW.id::text);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS family_on_ride_started ON public.rides;
CREATE TRIGGER family_on_ride_started AFTER UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.family_on_ride_started();

-- 2. Reached the night's stay: first fix within 500 m of a stay for that day.
CREATE TABLE IF NOT EXISTS public.family_stay_arrivals (
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stay_id uuid NOT NULL,
  arrived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, user_id, stay_id)
);
ALTER TABLE public.family_stay_arrivals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_stay_arrivals FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.family_on_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stay record; v_day date;
BEGIN
  -- Cheap exits first: this runs on every location insert.
  IF NOT EXISTS (SELECT 1 FROM public.family_contacts WHERE user_id = NEW.user_id AND NOT paused) THEN RETURN NEW; END IF;
  v_day := (coalesce(NEW."timestamp", now()) AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT s.id, s.name INTO v_stay FROM public.trip_stays s
   WHERE s.ride_id = NEW.ride_id AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
     AND (s.check_in IS NULL OR s.check_in = v_day)
     AND abs(s.latitude - NEW.lat) < 0.01 AND abs(s.longitude - NEW.lng) < 0.01
     AND public.distance_m(s.latitude, s.longitude, NEW.lat, NEW.lng) <= 500
     AND NOT EXISTS (SELECT 1 FROM public.family_stay_arrivals a WHERE a.ride_id = NEW.ride_id AND a.user_id = NEW.user_id AND a.stay_id = s.id)
   LIMIT 1;
  IF v_stay.id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = NEW.ride_id AND status = 'active') THEN RETURN NEW; END IF;
  INSERT INTO public.family_stay_arrivals (ride_id, user_id, stay_id) VALUES (NEW.ride_id, NEW.user_id, v_stay.id) ON CONFLICT DO NOTHING;
  PERFORM public.notify_family(NEW.ride_id, NEW.user_id, 'family_reached_stay', jsonb_build_object('stay', v_stay.name), 'family_stay:' || v_stay.id::text || ':' || NEW.user_id::text);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS family_on_location ON public.location_updates;
CREATE TRIGGER family_on_location AFTER INSERT ON public.location_updates
  FOR EACH ROW EXECUTE FUNCTION public.family_on_location();

-- 3. Unanswered check-in: the phone raises an alert of type check_in_missed.
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('emergency','break','fuel','mechanical','route_deviation','rider_behind','regroup','announcement','check_in_missed'));

-- A missed check-in may have no fix, like an SOS.
DROP POLICY IF EXISTS "Members insert own alerts" ON public.alerts;
CREATE POLICY "Members insert own alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_ride_participant(ride_id, auth.uid())
    AND (
      (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
      OR (type IN ('emergency', 'check_in_missed') AND lat IS NULL AND lng IS NULL)
    )
    AND (location_recorded_at IS NULL OR location_recorded_at <= now() + interval '2 minutes')
    AND (
      type IS DISTINCT FROM 'announcement'
      OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.family_on_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type = 'check_in_missed' THEN
    PERFORM public.notify_family(NEW.ride_id, NEW.user_id, 'family_check_in_missed', jsonb_build_object('minutes', '2'), 'family_checkin:' || NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS family_on_alert ON public.alerts;
CREATE TRIGGER family_on_alert AFTER INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.family_on_alert();

-- Spectator snapshot: adds who the link follows, planned arrival times, stays
-- and when the ride started, so the page can explain itself.
CREATE OR REPLACE FUNCTION public.get_public_ride_snapshot(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_link record;
  v_ride jsonb;
  v_waypoints jsonb;
  v_stays jsonb;
  v_participants jsonb;
  v_subject jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN RETURN NULL; END IF;
  SELECT l.ride_id, l.expires_at, l.kind, l.subject_user_id INTO v_link
    FROM public.ride_share_links l
   WHERE l.token = trim(p_token) AND l.revoked_at IS NULL AND l.expires_at > now() LIMIT 1;
  IF v_link.ride_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'origin', r.origin, 'destination', r.destination,
           'origin_coords', r.origin_coords, 'destination_coords', r.destination_coords, 'route_geometry', r.route_geometry,
           'started_at', r.started_at, 'ended_at', r.ended_at)
    INTO v_ride FROM public.rides r WHERE r.id = v_link.ride_id;
  IF v_ride IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'waypoint_type', w.waypoint_type, 'latitude', w.latitude,
           'longitude', w.longitude, 'sequence', w.sequence, 'planned_arrival', w.planned_arrival) ORDER BY w.sequence), '[]'::jsonb)
    INTO v_waypoints FROM public.trip_waypoints w WHERE w.ride_id = v_link.ride_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'latitude', s.latitude, 'longitude', s.longitude, 'check_in', s.check_in) ORDER BY s.check_in NULLS LAST), '[]'::jsonb)
    INTO v_stays FROM public.trip_stays s WHERE s.ride_id = v_link.ride_id AND s.latitude IS NOT NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', sub.user_id, 'display_name', sub.display_name, 'lat', sub.lat, 'lng', sub.lng,
           'speed', sub.speed, 'heading', sub.heading, 'timestamp', sub.timestamp)), '[]'::jsonb)
    INTO v_participants
    FROM (
      SELECT DISTINCT ON (rp.user_id) rp.user_id, coalesce(p.display_name, 'Rider') AS display_name,
             lu.lat, lu.lng, lu.speed, lu.heading, lu."timestamp" AS timestamp
        FROM public.ride_participants rp
        JOIN public.profiles p ON p.id = rp.user_id
        LEFT JOIN public.location_updates lu ON lu.ride_id = rp.ride_id AND lu.user_id = rp.user_id
       WHERE rp.ride_id = v_link.ride_id AND rp.is_active AND lu.lat IS NOT NULL AND lu.lng IS NOT NULL
       ORDER BY rp.user_id, lu."timestamp" DESC
    ) sub;

  IF v_link.subject_user_id IS NOT NULL THEN
    SELECT jsonb_build_object('user_id', p.id, 'display_name', coalesce(p.display_name, 'Your rider')) INTO v_subject
      FROM public.profiles p WHERE p.id = v_link.subject_user_id;
  END IF;

  RETURN jsonb_build_object('expires_at', v_link.expires_at, 'kind', v_link.kind, 'subject', v_subject, 'ride', v_ride,
    'waypoints', v_waypoints, 'stays', v_stays, 'participants', v_participants);
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_ride_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_ride_snapshot(text) TO anon, authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.save_family_contact(uuid, text, text, text)', 'public.delete_family_contact(uuid)',
    'public.set_family_updates_paused(boolean)', 'public.create_family_link(uuid)', 'public.revoke_my_family_links(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.flag_enabled(text) FROM PUBLIC, anon, authenticated;

COMMIT;
