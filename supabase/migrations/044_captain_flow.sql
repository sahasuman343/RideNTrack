-- F1 Guided captain flow: briefing, automatic roll call, start_ride gate,
-- sweep "All through" and debrief. Also moves rides.status behind RPCs
-- (clients could previously set any status directly).
BEGIN;

-- Briefing ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ride_briefings (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  hand_signals text[] NOT NULL DEFAULT '{}',
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.ride_briefing_reads (
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, user_id)
);
ALTER TABLE public.ride_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_briefing_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_briefings, public.ride_briefing_reads FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_ride_leadership(p_ride_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.ride_member_role(p_ride_id, p_user_id) IN ('captain', 'co-captain'), false);
$$;
REVOKE ALL ON FUNCTION public.is_ride_leadership(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.publish_ride_briefing(p_ride_id uuid, p_hand_signals text[], p_notes text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_ride_leadership(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only the captain can publish the briefing' USING ERRCODE = '42501';
  END IF;
  IF coalesce(array_length(p_hand_signals, 1), 0) > 12 THEN RAISE EXCEPTION 'Too many hand signals' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.ride_briefings AS b (ride_id, version, hand_signals, notes, published_by)
  VALUES (p_ride_id, 1, coalesce(p_hand_signals, '{}'), nullif(trim(p_notes), ''), auth.uid())
  ON CONFLICT (ride_id) DO UPDATE SET version = b.version + 1, hand_signals = EXCLUDED.hand_signals,
    notes = EXCLUDED.notes, published_at = now(), published_by = auth.uid()
  RETURNING version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ride_briefing(p_ride_id uuid)
RETURNS TABLE (version integer, hand_signals text[], notes text, published_at timestamptz, read_count integer, member_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.ride_member_role(p_ride_id, auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT b.version, b.hand_signals, b.notes, b.published_at,
    (SELECT count(*)::int FROM public.ride_briefing_reads r WHERE r.ride_id = b.ride_id AND r.version = b.version),
    (SELECT count(*)::int FROM public.ride_participants rp WHERE rp.ride_id = b.ride_id AND rp.is_active)
  FROM public.ride_briefings b WHERE b.ride_id = p_ride_id;
END;
$$;

-- Opening the briefing marks it read; there is no separate tap.
CREATE OR REPLACE FUNCTION public.mark_briefing_read(p_ride_id uuid, p_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.ride_member_role(p_ride_id, auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.ride_briefing_reads (ride_id, user_id, version) VALUES (p_ride_id, auth.uid(), p_version)
  ON CONFLICT (ride_id, user_id) DO UPDATE SET version = greatest(public.ride_briefing_reads.version, EXCLUDED.version), read_at = now();
END;
$$;

-- Roll call -----------------------------------------------------------------
ALTER TABLE public.ride_participants DROP CONSTRAINT IF EXISTS ride_participants_attendance_status_check;
ALTER TABLE public.ride_participants
  ADD CONSTRAINT ride_participants_attendance_status_check
  CHECK (attendance_status IN ('confirmed', 'tentative', 'declined', 'attended', 'checked_in', 'absent'));
ALTER TABLE public.ride_participants
  ADD COLUMN IF NOT EXISTS checked_in_by text CHECK (checked_in_by IS NULL OR checked_in_by IN ('location', 'captain', 'self')),
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_override_reason text,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- Meetup point: first meetup waypoint, else the origin waypoint, else origin_coords.
CREATE OR REPLACE FUNCTION public.ride_meetup_point(p_ride_id uuid)
RETURNS TABLE (lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.latitude, w.longitude FROM public.trip_waypoints w
   WHERE w.ride_id = p_ride_id AND w.waypoint_type IN ('meetup', 'origin')
   ORDER BY (w.waypoint_type = 'meetup') DESC, w.sequence LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.ride_meetup_point(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

-- A rider's phone reports a fresh fix near the meetup; the server checks the
-- distance (200 m) and age (5 min) so a client cannot check itself in from home.
CREATE OR REPLACE FUNCTION public.report_roll_call_location(p_ride_id uuid, p_lat double precision, p_lng double precision, p_fix_at timestamptz, p_accuracy double precision DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_meet record; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT r.status INTO v_status FROM public.rides r WHERE r.id = p_ride_id;
  IF v_status IS DISTINCT FROM 'planned' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id = p_ride_id AND user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501';
  END IF;
  IF p_fix_at < now() - interval '5 minutes' OR p_fix_at > now() + interval '1 minute' THEN RETURN false; END IF;
  IF p_accuracy IS NOT NULL AND p_accuracy > 100 THEN RETURN false; END IF;
  SELECT * INTO v_meet FROM public.ride_meetup_point(p_ride_id);
  IF v_meet.lat IS NULL OR public.distance_m(p_lat, p_lng, v_meet.lat, v_meet.lng) > 200 THEN RETURN false; END IF;
  UPDATE public.ride_participants
     SET attendance_status = 'checked_in', checked_in_by = 'location', checked_in_at = now()
   WHERE ride_id = p_ride_id AND user_id = auth.uid() AND attendance_status NOT IN ('checked_in', 'absent');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_roll_call_status(p_ride_id uuid, p_user_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF p_status NOT IN ('checked_in', 'absent', 'confirmed') THEN RAISE EXCEPTION 'Unknown roll call status' USING ERRCODE = '22023'; END IF;
  IF NOT (public.is_ride_leadership(p_ride_id, auth.uid()) OR (p_user_id = auth.uid() AND p_status = 'checked_in')) THEN
    RAISE EXCEPTION 'Only the captain can mark other riders' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ride_participants
     SET attendance_status = p_status,
         checked_in_by = CASE WHEN p_status = 'checked_in' THEN CASE WHEN p_user_id = auth.uid() THEN 'self' ELSE 'captain' END END,
         checked_in_at = CASE WHEN p_status = 'checked_in' THEN now() END
   WHERE ride_id = p_ride_id AND user_id = p_user_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rider not in this ride' USING ERRCODE = 'P0002'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_roll_call(p_ride_id uuid)
RETURNS TABLE (user_id uuid, display_name text, role text, attendance_status text, checked_in_by text, checked_in_at timestamptz, briefing_read boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.ride_member_role(p_ride_id, auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT rp.user_id, p.display_name, rp.role, rp.attendance_status, rp.checked_in_by, rp.checked_in_at,
         EXISTS (SELECT 1 FROM public.ride_briefing_reads br JOIN public.ride_briefings b ON b.ride_id = br.ride_id
                  WHERE br.ride_id = rp.ride_id AND br.user_id = rp.user_id AND br.version >= b.version)
    FROM public.ride_participants rp JOIN public.profiles p ON p.id = rp.user_id
   WHERE rp.ride_id = p_ride_id AND rp.is_active
   ORDER BY p.display_name;
END;
$$;

-- Ride status only changes through these functions ----------------------------
CREATE OR REPLACE FUNCTION public.guard_ride_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Only direct client writes are limited. SECURITY DEFINER functions
  -- (start_ride, end_ride, archive_trip, ...) run as their owner.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'planned';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Use start_ride or end_ride to change the ride status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_ride_status ON public.rides;
CREATE TRIGGER guard_ride_status BEFORE INSERT OR UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.guard_ride_status();

CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id uuid, p_override_reason text DEFAULT NULL)
RETURNS public.rides LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ride public.rides; v_waiting integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_ride_leadership(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only the captain or co-captain can start the ride' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.status = 'active' THEN RETURN v_ride; END IF;
  IF v_ride.status <> 'planned' THEN RAISE EXCEPTION 'This ride has already ended' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO v_waiting FROM public.ride_participants rp
   WHERE rp.ride_id = p_ride_id AND rp.is_active AND rp.user_id <> auth.uid() AND rp.user_id <> v_ride.admin_id
     AND rp.attendance_status NOT IN ('checked_in', 'attended', 'absent', 'declined');
  IF v_waiting > 0 AND nullif(trim(p_override_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Roll call not finished: % rider(s) still waiting', v_waiting USING ERRCODE = 'P0001', HINT = 'start_anyway';
  END IF;
  UPDATE public.rides SET status = 'active', started_at = now(), started_by = auth.uid(),
         start_override_reason = CASE WHEN v_waiting > 0 THEN left(trim(p_override_reason), 200) END
   WHERE id = p_ride_id RETURNING * INTO v_ride;
  RETURN v_ride;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_ride(p_ride_id uuid)
RETURNS public.rides LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ride public.rides;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_ride_leadership(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only the captain or co-captain can end the ride' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rides SET status = 'completed', ended_at = coalesce(ended_at, now())
   WHERE id = p_ride_id AND status IN ('planned', 'active') RETURNING * INTO v_ride;
  IF v_ride.id IS NULL THEN SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id; END IF;
  UPDATE public.ride_participants SET attendance_status = 'attended'
   WHERE ride_id = p_ride_id AND attendance_status = 'checked_in';
  RETURN v_ride;
END;
$$;

-- Sweep "All through" --------------------------------------------------------
ALTER TABLE public.trip_regroup_points
  ADD COLUMN IF NOT EXISTS missing_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS all_through_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.mark_regroup_all_through(p_regroup_point_id uuid)
RETURNS TABLE (missing_user_id uuid, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ride uuid; v_name text; v_missing uuid[]; v_names text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT p.ride_id, p.name INTO v_ride, v_name FROM public.trip_regroup_points p WHERE p.id = p_regroup_point_id;
  IF v_ride IS NULL THEN RAISE EXCEPTION 'Regroup point not found' USING ERRCODE = 'P0002'; END IF;
  IF coalesce(public.ride_member_role(v_ride, auth.uid()), '') NOT IN ('captain', 'co-captain', 'sweeper', 'marshal') THEN
    RAISE EXCEPTION 'Only the sweep, marshals or captain can mark all through' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(rp.user_id), '{}') INTO v_missing
    FROM public.ride_participants rp
   WHERE rp.ride_id = v_ride AND rp.is_active AND rp.attendance_status NOT IN ('absent', 'declined')
     AND NOT EXISTS (SELECT 1 FROM public.trip_regroup_arrivals a WHERE a.regroup_point_id = p_regroup_point_id AND a.user_id = rp.user_id)
     AND rp.user_id <> auth.uid();
  UPDATE public.trip_regroup_points
     SET status = 'closed', closed_at = coalesce(closed_at, now()), closed_by = coalesce(closed_by, auth.uid()),
         missing_user_ids = v_missing, all_through_by = auth.uid()
   WHERE id = p_regroup_point_id;
  SELECT string_agg(p.display_name, ', ' ORDER BY p.display_name) INTO v_names FROM public.profiles p WHERE p.id = ANY (v_missing);
  INSERT INTO public.alerts (ride_id, user_id, type, message)
  VALUES (v_ride, auth.uid(), 'regroup', CASE WHEN v_names IS NULL
    THEN 'All through at "' || v_name || '". Everyone accounted for.'
    ELSE 'Sweep passed "' || v_name || '". Not seen: ' || v_names || '.' END);
  RETURN QUERY SELECT p.id, p.display_name FROM public.profiles p WHERE p.id = ANY (v_missing) ORDER BY p.display_name;
END;
$$;

-- Debrief --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ride_debriefs (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  summary text NOT NULL CHECK (length(summary) <= 500),
  facts text[] NOT NULL DEFAULT '{}',
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  saved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ride_debriefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_debriefs FROM anon, authenticated;

-- Facts the app turns into the debrief (alerts, fuel spend, missing riders).
CREATE OR REPLACE FUNCTION public.get_debrief_inputs(p_ride_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.ride_member_role(p_ride_id, auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'alerts', coalesce((SELECT jsonb_agg(jsonb_build_object('type', a.type, 'created_at', a.created_at)) FROM public.alerts a WHERE a.ride_id = p_ride_id), '[]'::jsonb),
    'riders', (SELECT count(*) FROM public.ride_participants rp WHERE rp.ride_id = p_ride_id AND rp.is_active AND rp.attendance_status NOT IN ('absent', 'declined')),
    'started_at', (SELECT started_at FROM public.rides WHERE id = p_ride_id),
    'ended_at', (SELECT ended_at FROM public.rides WHERE id = p_ride_id),
    'start_override_reason', (SELECT start_override_reason FROM public.rides WHERE id = p_ride_id),
    'regroups_missing', coalesce((
      SELECT jsonb_agg(jsonb_build_object('point', g.name, 'names',
        (SELECT coalesce(jsonb_agg(p.display_name ORDER BY p.display_name), '[]'::jsonb) FROM public.profiles p WHERE p.id = ANY (g.missing_user_ids))))
        FROM public.trip_regroup_points g WHERE g.ride_id = p_ride_id AND cardinality(g.missing_user_ids) > 0), '[]'::jsonb),
    'debrief', (SELECT to_jsonb(d) - 'saved_by' FROM public.ride_debriefs d WHERE d.ride_id = p_ride_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_ride_debrief(p_ride_id uuid, p_summary text, p_facts text[], p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_ride_leadership(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only the captain can save the debrief' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.ride_debriefs (ride_id, summary, facts, notes, saved_by)
  VALUES (p_ride_id, left(p_summary, 500), coalesce(p_facts[1:20], '{}'), nullif(left(trim(p_notes), 2000), ''), auth.uid())
  ON CONFLICT (ride_id) DO UPDATE SET summary = EXCLUDED.summary, facts = EXCLUDED.facts, notes = EXCLUDED.notes,
    saved_by = EXCLUDED.saved_by, saved_at = now();
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.publish_ride_briefing(uuid, text[], text)', 'public.get_ride_briefing(uuid)', 'public.mark_briefing_read(uuid, integer)',
    'public.report_roll_call_location(uuid, double precision, double precision, timestamptz, double precision)',
    'public.set_roll_call_status(uuid, uuid, text)', 'public.get_roll_call(uuid)', 'public.start_ride(uuid, text)',
    'public.end_ride(uuid)', 'public.mark_regroup_all_through(uuid)', 'public.get_debrief_inputs(uuid)',
    'public.save_ride_debrief(uuid, text, text[], text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
