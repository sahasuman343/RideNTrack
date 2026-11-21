-- Migration 024: Phase 4 & 5 Smart Coordination and Safety Features
-- Regroup Closure Flow, Announcement Acknowledgements, Emergency Escalation, and Breakdown Directory
BEGIN;

-- 1. Regroup point closure flow
ALTER TABLE public.trip_regroup_points
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.profiles(id);

-- 2. Announcement acknowledgements
CREATE TABLE IF NOT EXISTS public.alert_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alert_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_acknowledgements_alert ON public.alert_acknowledgements(alert_id);

ALTER TABLE public.alert_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants read alert acknowledgements" ON public.alert_acknowledgements;
CREATE POLICY "Participants read alert acknowledgements" ON public.alert_acknowledgements
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.alerts a
    WHERE a.id = alert_id AND (
      public.is_ride_participant(a.ride_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = a.ride_id AND (r.admin_id = auth.uid() OR r.visibility = 'public'))
    )
  ));

DROP POLICY IF EXISTS "Participants insert own alert acknowledgement" ON public.alert_acknowledgements;
CREATE POLICY "Participants insert own alert acknowledgement" ON public.alert_acknowledgements
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.alerts a
      WHERE a.id = alert_id AND public.is_ride_participant(a.ride_id, auth.uid())
    )
  );

-- 3. Emergency escalation columns on alerts
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS is_escalated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS escalation_notes TEXT DEFAULT NULL;

-- 4. Breakdown assistance directory
CREATE TABLE IF NOT EXISTS public.breakdown_assistance_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('mechanic', 'towing', 'puncture', 'fuel', 'spare_parts', 'hospital')),
  region TEXT NOT NULL,
  phone TEXT NOT NULL,
  latitude DOUBLE PRECISION CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
  longitude DOUBLE PRECISION CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  notes TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.breakdown_assistance_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users view breakdown directory" ON public.breakdown_assistance_directory;
CREATE POLICY "Authenticated users view breakdown directory" ON public.breakdown_assistance_directory
  FOR SELECT TO authenticated
  USING (true);

-- Seed initial national highway emergency breakdown services
INSERT INTO public.breakdown_assistance_directory (name, category, region, phone, notes, is_verified)
VALUES
  ('NHAI 24x7 Highway Emergency Towing', 'towing', 'All India', '1033', 'National Highway Authority emergency response and vehicle clearance', true),
  ('Royal Enfield Roadside Assistance', 'mechanic', 'All India', '18002100007', '24x7 pan-India breakdown helpline for touring motorcycles', true),
  ('KTM Roadside Assistance', 'mechanic', 'All India', '18002660000', 'Emergency roadside support for KTM and Husqvarna tourers', true),
  ('Manali-Leh Highway Himalayan Rescue', 'mechanic', 'Ladakh & Himachal', '01982252018', 'Keylong, Darcha, Sarchu mountain rescue and mobile mechanic', true),
  ('Western Ghats Motorcycle Towing', 'puncture', 'Western Ghats / Goa', '9822144332', 'Flatbed recovery and tubeless puncture dispatch across ghat routes', true)
ON CONFLICT DO NOTHING;

-- 5. RPC: close_regroup_point
CREATE OR REPLACE FUNCTION public.close_regroup_point(p_regroup_point_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ride_id UUID;
  v_point_name TEXT;
  v_is_leader BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT p.ride_id, p.name INTO v_ride_id, v_point_name
  FROM public.trip_regroup_points p
  WHERE p.id = p_regroup_point_id;

  IF v_ride_id IS NULL THEN
    RAISE EXCEPTION 'Regroup point not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    LEFT JOIN public.ride_participants rp ON rp.ride_id = r.id AND rp.user_id = auth.uid()
    WHERE r.id = v_ride_id AND (r.admin_id = auth.uid() OR (rp.is_active AND rp.role IN ('captain', 'co-captain', 'leader')))
  ) INTO v_is_leader;

  IF NOT v_is_leader THEN
    RAISE EXCEPTION 'Only trip leadership can close regroup points' USING ERRCODE = '42501';
  END IF;

  UPDATE public.trip_regroup_points
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid()
  WHERE id = p_regroup_point_id;

  -- Broadcast regroup completion alert to the pack
  INSERT INTO public.alerts (ride_id, user_id, type, message)
  VALUES (v_ride_id, auth.uid(), 'regroup', 'Regroup at "' || v_point_name || '" completed. Ride resumed!');
END;
$$;

-- 6. RPC: get_regroup_points (updated to return status and closure timestamp)
DROP FUNCTION IF EXISTS public.get_regroup_points(UUID);
CREATE OR REPLACE FUNCTION public.get_regroup_points(p_ride_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  sequence INTEGER,
  target_arrival TIMESTAMPTZ,
  notes TEXT,
  arrived_count BIGINT,
  my_arrived BOOLEAN,
  status TEXT,
  closed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.name,
    p.latitude,
    p.longitude,
    p.sequence,
    p.target_arrival,
    p.notes,
    (SELECT count(*) FROM public.trip_regroup_arrivals a WHERE a.regroup_point_id = p.id),
    EXISTS (SELECT 1 FROM public.trip_regroup_arrivals a WHERE a.regroup_point_id = p.id AND a.user_id = auth.uid()),
    p.status,
    p.closed_at
  FROM public.trip_regroup_points p
  WHERE p.ride_id = p_ride_id AND (
    public.is_ride_participant(p_ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND (admin_id = auth.uid() OR visibility = 'public'))
  )
  ORDER BY p.sequence, p.created_at;
$$;

-- 7. RPC: acknowledge_alert
CREATE OR REPLACE FUNCTION public.acknowledge_alert(p_alert_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ride_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT a.ride_id INTO v_ride_id
  FROM public.alerts a
  WHERE a.id = p_alert_id;

  IF v_ride_id IS NULL THEN
    RAISE EXCEPTION 'Alert not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_ride_participant(v_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'Ride membership required to acknowledge alert' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.alert_acknowledgements (alert_id, user_id, acknowledged_at)
  VALUES (p_alert_id, auth.uid(), now())
  ON CONFLICT (alert_id, user_id) DO UPDATE SET acknowledged_at = now();
END;
$$;

-- 8. RPC: get_alert_acknowledgements
CREATE OR REPLACE FUNCTION public.get_alert_acknowledgements(p_alert_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  acknowledged_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ack.user_id, p.display_name, ack.acknowledged_at
  FROM public.alert_acknowledgements ack
  JOIN public.profiles p ON p.id = ack.user_id
  JOIN public.alerts a ON a.id = ack.alert_id
  WHERE ack.alert_id = p_alert_id AND (
    public.is_ride_participant(a.ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = a.ride_id AND admin_id = auth.uid())
  )
  ORDER BY ack.acknowledged_at ASC;
$$;

-- 9. RPC: escalate_emergency_alert
CREATE OR REPLACE FUNCTION public.escalate_emergency_alert(
  p_alert_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ride_id UUID;
  v_creator_id UUID;
  v_is_leader BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT a.ride_id, a.user_id INTO v_ride_id, v_creator_id
  FROM public.alerts a
  WHERE a.id = p_alert_id;

  IF v_ride_id IS NULL THEN
    RAISE EXCEPTION 'Alert not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    LEFT JOIN public.ride_participants rp ON rp.ride_id = r.id AND rp.user_id = auth.uid()
    WHERE r.id = v_ride_id AND (r.admin_id = auth.uid() OR (rp.is_active AND rp.role IN ('captain', 'co-captain', 'leader')))
  ) INTO v_is_leader;

  IF auth.uid() <> v_creator_id AND NOT v_is_leader THEN
    RAISE EXCEPTION 'Only the alert creator or trip leadership can escalate an emergency' USING ERRCODE = '42501';
  END IF;

  UPDATE public.alerts
  SET is_escalated = true,
      escalated_at = now(),
      escalation_notes = NULLIF(trim(p_notes), '')
  WHERE id = p_alert_id;
END;
$$;

-- 10. RPC: get_breakdown_assistance_directory
CREATE OR REPLACE FUNCTION public.get_breakdown_assistance_directory(
  p_region TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS SETOF public.breakdown_assistance_directory
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM public.breakdown_assistance_directory d
  WHERE (p_region IS NULL OR d.region ILIKE '%' || trim(p_region) || '%' OR d.region = 'All India')
    AND (p_category IS NULL OR d.category = p_category)
  ORDER BY d.is_verified DESC, d.name ASC;
$$;

-- Privileges
REVOKE ALL ON FUNCTION public.close_regroup_point(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_regroup_point(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_regroup_points(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_regroup_points(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.acknowledge_alert(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_alert(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_alert_acknowledgements(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_alert_acknowledgements(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.escalate_emergency_alert(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escalate_emergency_alert(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_breakdown_assistance_directory(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_breakdown_assistance_directory(TEXT, TEXT) TO authenticated;

COMMIT;
