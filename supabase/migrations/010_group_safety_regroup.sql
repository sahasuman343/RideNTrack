-- Phase 2: configurable group safety thresholds and regroup coordination.
BEGIN;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS route_deviation_threshold_meters INTEGER NOT NULL DEFAULT 500
    CHECK (route_deviation_threshold_meters BETWEEN 50 AND 5000),
  ADD COLUMN IF NOT EXISTS rider_behind_threshold_meters INTEGER NOT NULL DEFAULT 1000
    CHECK (rider_behind_threshold_meters BETWEEN 100 AND 10000);

ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('emergency','break','fuel','mechanical','route_deviation','rider_behind'));

CREATE TABLE IF NOT EXISTS public.trip_regroup_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  waypoint_id UUID REFERENCES public.trip_waypoints(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  sequence INTEGER NOT NULL DEFAULT 0,
  target_arrival TIMESTAMPTZ,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ride_id,sequence)
);
CREATE TABLE IF NOT EXISTS public.trip_regroup_arrivals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regroup_point_id UUID NOT NULL REFERENCES public.trip_regroup_points(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(regroup_point_id,user_id)
);
ALTER TABLE public.trip_regroup_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_regroup_arrivals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read regroup points" ON public.trip_regroup_points
  FOR SELECT TO authenticated USING (public.is_ride_participant(ride_id,auth.uid()));
CREATE POLICY "Members read regroup arrivals" ON public.trip_regroup_arrivals
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.trip_regroup_points p
    WHERE p.id=regroup_point_id AND public.is_ride_participant(p.ride_id,auth.uid())
  ));

CREATE OR REPLACE FUNCTION public.update_group_safety_settings(
  p_ride_id UUID,p_route_deviation_meters INTEGER,p_rider_behind_meters INTEGER
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  IF p_route_deviation_meters NOT BETWEEN 50 AND 5000 OR p_rider_behind_meters NOT BETWEEN 100 AND 10000 THEN
    RAISE EXCEPTION 'Safety thresholds are outside the allowed range';
  END IF;
  UPDATE public.rides SET route_deviation_threshold_meters=p_route_deviation_meters,
    rider_behind_threshold_meters=p_rider_behind_meters
  WHERE id=p_ride_id AND admin_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the trip leader can change safety settings' USING ERRCODE='42501'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.add_regroup_point(
  p_ride_id UUID,p_name TEXT,p_latitude DOUBLE PRECISION,p_longitude DOUBLE PRECISION,
  p_sequence INTEGER DEFAULT 0,p_target_arrival TIMESTAMPTZ DEFAULT NULL,p_notes TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  IF NULLIF(trim(p_name),'') IS NULL OR p_latitude NOT BETWEEN -90 AND 90
    OR p_longitude NOT BETWEEN -180 AND 180 OR p_sequence < 0 THEN
    RAISE EXCEPTION 'Invalid regroup point details';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rides r JOIN public.ride_participants rp ON rp.ride_id=r.id
    WHERE r.id=p_ride_id AND r.admin_id=auth.uid() AND rp.user_id=auth.uid()
      AND rp.is_active AND rp.role='leader') THEN
    RAISE EXCEPTION 'Only the trip leader can add regroup points' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.trip_regroup_points(ride_id,name,latitude,longitude,sequence,target_arrival,notes,created_by)
  VALUES(p_ride_id,trim(p_name),p_latitude,p_longitude,p_sequence,p_target_arrival,p_notes,auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_regroup_arrival(p_regroup_point_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_ride_id UUID; v_arrival UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  SELECT ride_id INTO v_ride_id FROM public.trip_regroup_points WHERE id=p_regroup_point_id;
  IF v_ride_id IS NULL OR NOT public.is_ride_participant(v_ride_id,auth.uid()) THEN
    RAISE EXCEPTION 'Regroup point not found or membership required' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.trip_regroup_arrivals(regroup_point_id,user_id)
  VALUES(p_regroup_point_id,auth.uid())
  ON CONFLICT(regroup_point_id,user_id) DO UPDATE SET confirmed_at=now()
  RETURNING id INTO v_arrival;
  RETURN v_arrival;
END; $$;

CREATE OR REPLACE FUNCTION public.get_regroup_points(p_ride_id UUID)
RETURNS TABLE(id UUID,name TEXT,latitude DOUBLE PRECISION,longitude DOUBLE PRECISION,
  sequence INTEGER,target_arrival TIMESTAMPTZ,notes TEXT,arrived_count BIGINT,my_arrived BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id,p.name,p.latitude,p.longitude,p.sequence,p.target_arrival,p.notes,
    (SELECT count(*) FROM public.trip_regroup_arrivals a WHERE a.regroup_point_id=p.id),
    EXISTS(SELECT 1 FROM public.trip_regroup_arrivals a WHERE a.regroup_point_id=p.id AND a.user_id=auth.uid())
  FROM public.trip_regroup_points p
  WHERE p.ride_id=p_ride_id AND public.is_ride_participant(p_ride_id,auth.uid())
  ORDER BY p.sequence,p.created_at;
$$;

REVOKE ALL ON FUNCTION public.update_group_safety_settings(UUID,INTEGER,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_group_safety_settings(UUID,INTEGER,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.add_regroup_point(UUID,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,INTEGER,TIMESTAMPTZ,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_regroup_point(UUID,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,INTEGER,TIMESTAMPTZ,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_regroup_arrival(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_regroup_arrival(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_regroup_points(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_regroup_points(UUID) TO authenticated;

COMMIT;
