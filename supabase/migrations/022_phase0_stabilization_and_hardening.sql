-- Phase 0 Hardening: Authorization, Regroup Role Permissiveness, and RLS Leak Prevention
BEGIN;

-- 1. Prevent hard-delete bypass on ride participants: all exits must use public.leave_ride() or public.remove_trip_participant()
DROP POLICY IF EXISTS "Users can leave rides" ON public.ride_participants;

-- 2. Update add_regroup_point to allow both 'captain' and 'leader' roles
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
  IF NOT EXISTS (SELECT 1 FROM public.rides r JOIN public.ride_participants rp ON rp.ride_id=r.id
    WHERE r.id=p_ride_id AND r.admin_id=auth.uid() AND rp.user_id=auth.uid()
      AND rp.is_active AND rp.role IN ('captain', 'leader')) THEN
    RAISE EXCEPTION 'Only the trip leader can add regroup points' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.trip_regroup_points(ride_id,name,latitude,longitude,sequence,target_arrival,notes,created_by)
  VALUES(p_ride_id,trim(p_name),p_latitude,p_longitude,p_sequence,p_target_arrival,p_notes,auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.add_regroup_point(UUID,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,INTEGER,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_regroup_point(UUID,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,INTEGER,TIMESTAMPTZ,TEXT) TO authenticated;

-- 3. Public community touring discovery: allow read access on days, stays, and stages for public trips
DROP POLICY IF EXISTS "Trip days visible to ride members" ON public.trip_days;
CREATE POLICY "Trip days visible to ride members" ON public.trip_days
  FOR SELECT USING (
    public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND (admin_id = auth.uid() OR visibility = 'public'))
  );

DROP POLICY IF EXISTS "Trip stays visible to ride members" ON public.trip_stays;
CREATE POLICY "Trip stays visible to ride members" ON public.trip_stays
  FOR SELECT USING (
    public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND (admin_id = auth.uid() OR visibility = 'public'))
  );

DROP POLICY IF EXISTS "Trip stages visible to ride members" ON public.trip_stages;
CREATE POLICY "Trip stages visible to ride members" ON public.trip_stages
  FOR SELECT USING (
    public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND (admin_id = auth.uid() OR visibility = 'public'))
  );

-- 4. Set search_path on auth profile trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name;
  RETURN NEW;
END;
$$;

-- 5. Foreign key consistency: cascade expense records from public.profiles
ALTER TABLE public.trip_expenses
  DROP CONSTRAINT IF EXISTS trip_expenses_payer_id_fkey;
ALTER TABLE public.trip_expenses
  ADD CONSTRAINT trip_expenses_payer_id_fkey
  FOREIGN KEY (payer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.trip_expense_splits
  DROP CONSTRAINT IF EXISTS trip_expense_splits_user_id_fkey;
ALTER TABLE public.trip_expense_splits
  ADD CONSTRAINT trip_expense_splits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

COMMIT;
