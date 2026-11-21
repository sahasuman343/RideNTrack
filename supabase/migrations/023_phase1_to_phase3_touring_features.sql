-- Migration 023: Phases 1 to 3 Complete Touring Implementation
-- Trip Access Controls & Sharing, User Saved Places, Group Capacity & Ride Rules, Attendance, and Co-Captain Permissions
BEGIN;

-- 1. Extend public.rides with capacity limit and ride rules
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS max_participants INTEGER DEFAULT NULL CHECK (max_participants IS NULL OR (max_participants >= 2 AND max_participants <= 500)),
  ADD COLUMN IF NOT EXISTS ride_rules TEXT DEFAULT NULL;

-- 2. Extend public.ride_participants with attendance status
ALTER TABLE public.ride_participants
  ADD COLUMN IF NOT EXISTS attendance_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (attendance_status IN ('confirmed', 'tentative', 'declined', 'attended'));

-- 3. Create user_saved_places for destination lists and bookmarking
CREATE TABLE IF NOT EXISTS public.user_saved_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) >= 1),
  category TEXT NOT NULL CHECK (category IN ('viewpoint', 'pass', 'fuel', 'food', 'stay', 'repair', 'other')),
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_saved_places_user ON public.user_saved_places(user_id);

ALTER TABLE public.user_saved_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own saved places" ON public.user_saved_places;
CREATE POLICY "Users can manage own saved places" ON public.user_saved_places
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. RPC: add_saved_place
CREATE OR REPLACE FUNCTION public.add_saved_place(
  p_name TEXT,
  p_category TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_address TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Place name is required';
  END IF;

  IF p_category NOT IN ('viewpoint', 'pass', 'fuel', 'food', 'stay', 'repair', 'other') THEN
    RAISE EXCEPTION 'Invalid category: %', p_category;
  END IF;

  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;

  INSERT INTO public.user_saved_places (
    user_id, name, category, latitude, longitude, address, notes
  ) VALUES (
    auth.uid(), trim(p_name), p_category, p_latitude, p_longitude, NULLIF(trim(p_address), ''), NULLIF(trim(p_notes), '')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 5. RPC: delete_saved_place
CREATE OR REPLACE FUNCTION public.delete_saved_place(p_place_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.user_saved_places
  WHERE id = p_place_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saved place not found or unauthorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- 6. RPC: get_user_saved_places
CREATE OR REPLACE FUNCTION public.get_user_saved_places()
RETURNS TABLE (
  id UUID,
  name TEXT,
  category TEXT,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  notes TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.name, s.category, s.address, s.latitude, s.longitude, s.notes, s.created_at
  FROM public.user_saved_places s
  WHERE s.user_id = auth.uid()
  ORDER BY s.created_at DESC;
$$;

-- 7. RPC: update_trip_access_control
CREATE OR REPLACE FUNCTION public.update_trip_access_control(
  p_ride_id UUID,
  p_visibility TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_visibility NOT IN ('private', 'invite_only', 'public') THEN
    RAISE EXCEPTION 'Invalid visibility mode: %', p_visibility;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rides r
    LEFT JOIN public.ride_participants rp ON rp.ride_id = r.id AND rp.user_id = auth.uid()
    WHERE r.id = p_ride_id AND (r.admin_id = auth.uid() OR (rp.is_active AND rp.role IN ('captain', 'co-captain', 'leader')))
  ) THEN
    RAISE EXCEPTION 'Only trip leadership can change access controls' USING ERRCODE = '42501';
  END IF;

  UPDATE public.rides
  SET visibility = p_visibility
  WHERE id = p_ride_id;

  RETURN p_visibility;
END;
$$;

-- 8. RPC: update_trip_capacity_and_rules
CREATE OR REPLACE FUNCTION public.update_trip_capacity_and_rules(
  p_ride_id UUID,
  p_max_participants INTEGER DEFAULT NULL,
  p_ride_rules TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_max_participants IS NOT NULL AND (p_max_participants < 2 OR p_max_participants > 500) THEN
    RAISE EXCEPTION 'Maximum participants must be between 2 and 500';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rides r
    LEFT JOIN public.ride_participants rp ON rp.ride_id = r.id AND rp.user_id = auth.uid()
    WHERE r.id = p_ride_id AND (r.admin_id = auth.uid() OR (rp.is_active AND rp.role IN ('captain', 'co-captain', 'leader')))
  ) THEN
    RAISE EXCEPTION 'Only trip leadership can update capacity and rules' USING ERRCODE = '42501';
  END IF;

  UPDATE public.rides
  SET max_participants = p_max_participants,
      ride_rules = NULLIF(trim(p_ride_rules), '')
  WHERE id = p_ride_id;
END;
$$;

-- 9. RPC: update_participant_attendance
CREATE OR REPLACE FUNCTION public.update_participant_attendance(
  p_ride_id UUID,
  p_status TEXT,
  p_target_user_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_to_update UUID;
  v_is_leader BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('confirmed', 'tentative', 'declined', 'attended') THEN
    RAISE EXCEPTION 'Invalid attendance status: %', p_status;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    LEFT JOIN public.ride_participants rp ON rp.ride_id = r.id AND rp.user_id = auth.uid()
    WHERE r.id = p_ride_id AND (r.admin_id = auth.uid() OR (rp.is_active AND rp.role IN ('captain', 'co-captain', 'leader')))
  ) INTO v_is_leader;

  IF p_target_user_id IS NOT NULL AND p_target_user_id <> auth.uid() THEN
    IF NOT v_is_leader THEN
      RAISE EXCEPTION 'Only trip leaders can update attendance of other riders' USING ERRCODE = '42501';
    END IF;
    v_user_to_update := p_target_user_id;
  ELSE
    v_user_to_update := auth.uid();
  END IF;

  UPDATE public.ride_participants
  SET attendance_status = p_status
  WHERE ride_id = p_ride_id AND user_id = v_user_to_update AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant record not found or not active' USING ERRCODE = 'P0002';
  END IF;

  RETURN p_status;
END;
$$;

-- 10. Update join_ride_by_code to enforce capacity limit
CREATE OR REPLACE FUNCTION public.join_ride_by_code(p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_current_count INTEGER;
  v_already_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to join a ride'; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE ride_code = upper(trim(p_code)) AND status != 'completed';
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Invalid ride code or ride has ended'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ride_participants WHERE ride_id = v_ride.id AND user_id = auth.uid() AND is_active = true
  ) INTO v_already_member;

  IF NOT v_already_member AND v_ride.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_current_count FROM public.ride_participants
    WHERE ride_id = v_ride.id AND is_active = true;

    IF v_current_count >= v_ride.max_participants THEN
      RAISE EXCEPTION 'Group ride has reached maximum capacity (% riders)', v_ride.max_participants
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.ride_participants (ride_id, user_id, attendance_status)
  VALUES (v_ride.id, auth.uid(), 'confirmed')
  ON CONFLICT (ride_id, user_id) DO UPDATE SET is_active = true;

  RETURN v_ride.id;
END; $$;

-- 11. Update accept_trip_invitation to enforce capacity limit
CREATE OR REPLACE FUNCTION public.accept_trip_invitation(p_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_inv public.trip_invitations%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_email TEXT;
  v_current_count INTEGER;
  v_already_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id=auth.uid();
  SELECT * INTO v_inv FROM public.trip_invitations i
    WHERE i.token=p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'Invitation is no longer pending'; END IF;
  IF v_inv.expires_at <= now() THEN
    UPDATE public.trip_invitations SET status='expired' WHERE id=v_inv.id;
    RETURN NULL;
  END IF;
  IF v_inv.invited_email IS NOT NULL AND v_inv.invited_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_inv.ride_id;
  SELECT EXISTS (
    SELECT 1 FROM public.ride_participants WHERE ride_id = v_ride.id AND user_id = auth.uid() AND is_active = true
  ) INTO v_already_member;

  IF NOT v_already_member AND v_ride.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_current_count FROM public.ride_participants
    WHERE ride_id = v_ride.id AND is_active = true;

    IF v_current_count >= v_ride.max_participants THEN
      RAISE EXCEPTION 'Group ride has reached maximum capacity (% riders)', v_ride.max_participants
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.ride_participants(ride_id, user_id, is_active, role, attendance_status)
  VALUES(v_inv.ride_id, auth.uid(), true, v_inv.assigned_role, 'confirmed')
  ON CONFLICT(ride_id, user_id) DO UPDATE SET is_active=true,
    role=CASE WHEN public.ride_participants.role IN ('captain', 'leader') THEN public.ride_participants.role ELSE EXCLUDED.role END;

  UPDATE public.trip_invitations SET status='accepted', accepted_by=auth.uid(), accepted_at=now()
    WHERE id=v_inv.id;

  RETURN v_inv.ride_id;
END;
$$;

-- 12. Update add_regroup_point to allow co-captains as well
CREATE OR REPLACE FUNCTION public.add_regroup_point(
  p_ride_id UUID,
  p_name TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_sequence INTEGER DEFAULT 0,
  p_target_arrival TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
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
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r
    JOIN public.ride_participants rp ON rp.ride_id=r.id
    WHERE r.id=p_ride_id AND rp.user_id=auth.uid()
      AND rp.is_active AND (r.admin_id=auth.uid() OR rp.role IN ('captain', 'co-captain', 'leader'))
  ) THEN
    RAISE EXCEPTION 'Only trip leadership can add regroup points' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.trip_regroup_points(ride_id,name,latitude,longitude,sequence,target_arrival,notes,created_by)
  VALUES(p_ride_id,trim(p_name),p_latitude,p_longitude,p_sequence,p_target_arrival,p_notes,auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- 13. Update get_trip_roster to include attendance_status
DROP FUNCTION IF EXISTS public.get_trip_roster(UUID);
CREATE OR REPLACE FUNCTION public.get_trip_roster(p_ride_id UUID)
RETURNS TABLE(user_id UUID, display_name TEXT, role TEXT, is_active BOOLEAN, last_seen TIMESTAMPTZ, attendance_status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT rp.user_id, p.display_name, rp.role, rp.is_active, latest.timestamp, rp.attendance_status
  FROM public.ride_participants rp
  JOIN public.profiles p ON p.id = rp.user_id
  LEFT JOIN LATERAL (
    SELECT l.timestamp FROM public.location_updates l
    WHERE l.ride_id = rp.ride_id AND l.user_id = rp.user_id
    ORDER BY l.timestamp DESC LIMIT 1
  ) latest ON true
  WHERE rp.ride_id = p_ride_id AND rp.is_active
    AND (public.is_ride_participant(p_ride_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND (admin_id = auth.uid() OR visibility = 'public')))
  ORDER BY CASE rp.role WHEN 'captain' THEN 0 WHEN 'leader' THEN 0 WHEN 'co-captain' THEN 1 WHEN 'marshal' THEN 2 WHEN 'sweeper' THEN 3 WHEN 'sweep' THEN 3 ELSE 4 END, p.display_name;
$$;

-- 14. Revoke and Grant Permissions
REVOKE ALL ON FUNCTION public.get_trip_roster(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_roster(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.add_saved_place(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_saved_place(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_saved_place(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_saved_place(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_saved_places() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_saved_places() TO authenticated;

REVOKE ALL ON FUNCTION public.update_trip_access_control(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_trip_access_control(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.update_trip_capacity_and_rules(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_trip_capacity_and_rules(UUID, INTEGER, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.update_participant_attendance(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_participant_attendance(UUID, TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.join_ride_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_ride_by_code(text) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_trip_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_trip_invitation(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.add_regroup_point(UUID,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,INTEGER,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_regroup_point(UUID,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,INTEGER,TIMESTAMPTZ,TEXT) TO authenticated;

COMMIT;
