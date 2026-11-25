-- F11 rider road reports: anyone signed in can report a hazard at a point;
-- reports expire after 48 hours, and each confirmation by another rider adds
-- 24 hours (at most 7 days from the report). Rate-limited per rider; ride
-- leaders can hide a report for their own ride. Clients use RPCs only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.road_reports (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('pothole', 'landslide', 'water_crossing', 'snow_ice', 'closure', 'police_check', 'animals', 'accident', 'fuel_out', 'other')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  note text CHECK (note IS NULL OR length(note) <= 140),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  confirm_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_road_reports_area ON public.road_reports (lat, lng) ;
CREATE INDEX IF NOT EXISTS idx_road_reports_creator ON public.road_reports (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.road_report_confirmations (
  report_id uuid NOT NULL REFERENCES public.road_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.road_report_hides (
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.road_reports(id) ON DELETE CASCADE,
  hidden_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, report_id)
);

ALTER TABLE public.road_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.road_report_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.road_report_hides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.road_reports, public.road_report_confirmations, public.road_report_hides FROM anon, authenticated;

-- The id is the phone's queue id, so a retry after a lost acknowledgement is a no-op.
CREATE OR REPLACE FUNCTION public.create_road_report(p_id uuid, p_type text, p_lat double precision, p_lng double precision, p_note text DEFAULT NULL, p_ride_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '28000'; END IF;
  IF EXISTS (SELECT 1 FROM public.road_reports WHERE id = p_id) THEN
    IF EXISTS (SELECT 1 FROM public.road_reports WHERE id = p_id AND created_by = v_uid) THEN RETURN p_id; END IF;
    RAISE EXCEPTION 'Report id in use' USING ERRCODE = '23505';
  END IF;
  IF p_ride_id IS NOT NULL AND NOT public.is_ride_participant(p_ride_id, v_uid) THEN
    RAISE EXCEPTION 'Not on this ride' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.road_reports WHERE created_by = v_uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Too many road reports in the last hour' USING ERRCODE = 'P0001', HINT = 'rate_limited';
  END IF;
  INSERT INTO public.road_reports (id, type, lat, lng, note, created_by, ride_id)
  VALUES (p_id, p_type, p_lat, p_lng, nullif(btrim(p_note), ''), v_uid, p_ride_id);
  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_road_report(p_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); r public.road_reports; v_new timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '28000'; END IF;
  SELECT * INTO r FROM public.road_reports WHERE id = p_id AND expires_at > now() FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Report not found or expired' USING ERRCODE = 'P0002'; END IF;
  IF r.created_by = v_uid THEN RETURN r.expires_at; END IF;
  INSERT INTO public.road_report_confirmations (report_id, user_id) VALUES (p_id, v_uid) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN r.expires_at; END IF;
  v_new := least(greatest(r.expires_at, now()) + interval '24 hours', r.created_at + interval '7 days');
  UPDATE public.road_reports SET confirm_count = confirm_count + 1, expires_at = v_new WHERE id = p_id;
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.hide_road_report(p_ride_id uuid, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_ride_leadership(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only the captain can hide reports for this ride' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.road_report_hides (ride_id, report_id, hidden_by) VALUES (p_ride_id, p_id, auth.uid())
  ON CONFLICT DO NOTHING;
END;
$$;

-- Active reports in a box; the reporter's name is never returned.
CREATE OR REPLACE FUNCTION public.get_road_reports_in_bbox(p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision, p_ride_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, type text, lat double precision, lng double precision, note text, created_at timestamptz, expires_at timestamptz, confirm_count integer, mine boolean, confirmed_by_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.type, r.lat, r.lng, r.note, r.created_at, r.expires_at, r.confirm_count,
         r.created_by = auth.uid(),
         EXISTS (SELECT 1 FROM public.road_report_confirmations c WHERE c.report_id = r.id AND c.user_id = auth.uid())
  FROM public.road_reports r
  WHERE auth.uid() IS NOT NULL
    AND r.expires_at > now()
    AND r.lat BETWEEN p_min_lat AND p_max_lat AND r.lng BETWEEN p_min_lng AND p_max_lng
    AND (p_max_lat - p_min_lat) <= 10 AND (p_max_lng - p_min_lng) <= 10
    AND (p_ride_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.road_report_hides h WHERE h.ride_id = p_ride_id AND h.report_id = r.id))
  ORDER BY r.created_at DESC
  LIMIT 300;
$$;

REVOKE ALL ON FUNCTION public.create_road_report(uuid, text, double precision, double precision, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_road_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hide_road_report(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_road_reports_in_bbox(double precision, double precision, double precision, double precision, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_road_report(uuid, text, double precision, double precision, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_road_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hide_road_report(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_road_reports_in_bbox(double precision, double precision, double precision, double precision, uuid) TO authenticated;

COMMIT;
