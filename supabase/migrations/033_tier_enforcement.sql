-- Migration: 2-Tier Monetization Enforcement (Host-Unlocks-Group + Expedition Passes)
BEGIN;

CREATE TABLE IF NOT EXISTS public.trip_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  purchased_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_passes_ride_active
  ON public.trip_passes (ride_id)
  WHERE status = 'active';

ALTER TABLE public.trip_passes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Trip passes viewable by ride members" ON public.trip_passes;
CREATE POLICY "Trip passes viewable by ride members" ON public.trip_passes
  FOR SELECT TO authenticated
  USING (
    purchased_by = auth.uid()
    OR public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

-- SECURITY DEFINER helper: Host-Unlocks-Group check
CREATE OR REPLACE FUNCTION public.ride_has_pro_access(p_ride_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    JOIN public.profiles p ON p.id = r.admin_id
    WHERE r.id = p_ride_id
      AND p.subscription_tier = 'pro_tourer'
  )
  OR EXISTS (
    SELECT 1
    FROM public.trip_passes tp
    WHERE tp.ride_id = p_ride_id
      AND tp.status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.ride_has_pro_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ride_has_pro_access(uuid) TO authenticated;

-- Upgrade waypoint cap trigger: 50 for Pro/Pass rides, 5 for Free rides
CREATE OR REPLACE FUNCTION public.enforce_waypoint_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
BEGIN
  v_limit := CASE WHEN public.ride_has_pro_access(NEW.ride_id) THEN 50 ELSE 5 END;
  IF (SELECT count(*) FROM public.trip_waypoints WHERE ride_id = NEW.ride_id) > v_limit THEN
    RAISE EXCEPTION 'Waypoint limit reached for your plan (% max). Upgrade to Pro Tourer for up to 50 waypoints.', v_limit
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_waypoint_limit() FROM PUBLIC, anon, authenticated;

-- Trip day cap trigger: unlimited for Pro/Pass rides, 2 days for Free rides
CREATE OR REPLACE FUNCTION public.enforce_trip_day_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT public.ride_has_pro_access(NEW.ride_id)
     AND (SELECT count(*) FROM public.trip_days WHERE ride_id = NEW.ride_id) > 2 THEN
    RAISE EXCEPTION 'Free trips support up to 2 days. Upgrade to Pro Tourer or activate an Expedition Pass for multi-day tours.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_trip_day_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_trip_day_limit ON public.trip_days;
CREATE CONSTRAINT TRIGGER enforce_trip_day_limit
  AFTER INSERT OR UPDATE OF ride_id ON public.trip_days
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trip_day_limit();

-- Participant cap trigger: 50 for Pro/Pass rides, 6 for Free rides
CREATE OR REPLACE FUNCTION public.enforce_participant_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_active_count integer;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_limit := CASE WHEN public.ride_has_pro_access(NEW.ride_id) THEN 50 ELSE 6 END;

  SELECT count(*) INTO v_active_count
  FROM public.ride_participants
  WHERE ride_id = NEW.ride_id AND is_active = true;

  IF v_active_count > v_limit THEN
    RAISE EXCEPTION 'Pack limit reached (% riders max). Host can upgrade to Pro Tourer to unlock larger packs.', v_limit
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_participant_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_participant_limit ON public.ride_participants;
CREATE CONSTRAINT TRIGGER enforce_participant_limit
  AFTER INSERT OR UPDATE OF ride_id, is_active ON public.ride_participants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_participant_limit();

-- Location history retention: purge >7d only for non-Pro rides
CREATE OR REPLACE FUNCTION public.purge_old_location_history(p_retention_days integer DEFAULT 7)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  IF p_retention_days < 7 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'Retention must be between 7 and 3650 days';
  END IF;
  DELETE FROM public.location_updates lu
   WHERE lu."timestamp" < now() - make_interval(days => p_retention_days)
     AND NOT public.ride_has_pro_access(lu.ride_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_location_history(integer) FROM PUBLIC, anon, authenticated;

COMMIT;
