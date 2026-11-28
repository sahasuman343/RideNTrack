-- R5: Ride ready check. Each rider reports what is still missing for a trip
-- (computed on the phone by shared/readiness.ts, because most items are device
-- permissions); captains see everyone's state on the roster.
BEGIN;

-- Shared helper for role checks in this and later migrations. The ride admin
-- is always the captain; otherwise the active participant row decides.
CREATE OR REPLACE FUNCTION public.ride_member_role(p_ride_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.rides r WHERE r.id = p_ride_id AND r.admin_id = p_user_id) THEN 'captain'
           ELSE (
             SELECT CASE rp.role WHEN 'leader' THEN 'captain' WHEN 'sweep' THEN 'sweeper' WHEN 'rider' THEN 'member' ELSE rp.role END
               FROM public.ride_participants rp
              WHERE rp.ride_id = p_ride_id AND rp.user_id = p_user_id AND rp.is_active
              LIMIT 1
           )
         END;
$$;
REVOKE ALL ON FUNCTION public.ride_member_role(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.ride_readiness (
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  missing text[] NOT NULL DEFAULT '{}',
  ready boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, user_id)
);
ALTER TABLE public.ride_readiness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_readiness FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_ride_readiness(p_ride_id uuid, p_missing text[], p_ready boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean text[];
BEGIN
  IF v_uid IS NULL OR public.ride_member_role(p_ride_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT m), '{}') INTO v_clean
    FROM unnest(COALESCE(p_missing, '{}')) AS m
   WHERE m IN ('bike_model', 'emergency_contact', 'phone', 'family_contacts', 'ice_consent',
               'offline_maps', 'background_location', 'notifications', 'battery_optimisation');
  INSERT INTO public.ride_readiness (ride_id, user_id, missing, ready, updated_at)
  VALUES (p_ride_id, v_uid, v_clean, COALESCE(p_ready, false), now())
  ON CONFLICT (ride_id, user_id) DO UPDATE
    SET missing = EXCLUDED.missing, ready = EXCLUDED.ready, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.report_ride_readiness(uuid, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_ride_readiness(uuid, text[], boolean) TO authenticated;

-- Captain and co-captain see every rider; everyone else sees only themselves.
CREATE OR REPLACE FUNCTION public.get_ride_readiness(p_ride_id uuid)
RETURNS TABLE (user_id uuid, missing text[], ready boolean, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rr.user_id, rr.missing, rr.ready, rr.updated_at
    FROM public.ride_readiness rr
   WHERE rr.ride_id = p_ride_id
     AND (
       rr.user_id = auth.uid()
       OR public.ride_member_role(p_ride_id, auth.uid()) IN ('captain', 'co-captain')
     );
$$;
REVOKE ALL ON FUNCTION public.get_ride_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_readiness(uuid) TO authenticated;

COMMIT;
