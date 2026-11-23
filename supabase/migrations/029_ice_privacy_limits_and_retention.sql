BEGIN;

-- Explicit opt-in is required before medical ICE data is disclosed to peers.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS share_ice_with_ride boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ice_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'pro_tourer'));

-- Clients may change consent and ordinary profile data, but not purchase state.
CREATE OR REPLACE FUNCTION public.protect_subscription_tier() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Subscription tier is managed by the payment backend' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.ice_consent_at IS DISTINCT FROM OLD.ice_consent_at
     AND NEW.share_ice_with_ride IS NOT DISTINCT FROM OLD.share_ice_with_ride
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Consent timestamp is managed by the database' USING ERRCODE = '42501';
  END IF;
  IF NEW.share_ice_with_ride IS DISTINCT FROM TRUE AND NEW.ice_consent_at IS NOT NULL THEN
    NEW.ice_consent_at := NULL;
  END IF;
  IF NEW.share_ice_with_ride IS TRUE AND (TG_OP = 'INSERT' OR OLD.share_ice_with_ride IS DISTINCT FROM TRUE) THEN
    NEW.ice_consent_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_subscription_tier() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_subscription_tier ON public.profiles;
CREATE TRIGGER protect_subscription_tier BEFORE INSERT OR UPDATE OF
  subscription_tier, share_ice_with_ride, ice_consent_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_subscription_tier();

CREATE OR REPLACE FUNCTION public.get_ride_ice_contacts(p_ride_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  blood_group text,
  emergency_contact text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.ride_participants rp
    JOIN public.rides r ON r.id = rp.ride_id
    WHERE rp.ride_id = p_ride_id AND rp.user_id = auth.uid() AND rp.is_active
      AND r.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only participants in an active ride can view emergency details' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.blood_group, p.emergency_contact
      FROM public.ride_participants rp
      JOIN public.profiles p ON p.id = rp.user_id
     WHERE rp.ride_id = p_ride_id AND rp.is_active
       AND p.share_ice_with_ride = true
       AND (p.blood_group IS NOT NULL OR p.emergency_contact IS NOT NULL)
     ORDER BY p.display_name;
END $$;
REVOKE ALL ON FUNCTION public.get_ride_ice_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_ice_contacts(uuid) TO authenticated;

-- Enforce plan limits at the database boundary. Constraint triggers run at
-- transaction commit, after aggregate route replacement has removed old rows.
CREATE OR REPLACE FUNCTION public.enforce_active_trip_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_limit integer;
BEGIN
  IF NEW.status IN ('completed', 'archived') THEN RETURN NEW; END IF;
  SELECT CASE WHEN p.subscription_tier = 'pro_tourer' THEN 100 ELSE 5 END
    INTO v_limit FROM public.profiles p WHERE p.id = NEW.admin_id;
  IF v_limit IS NOT NULL AND (
    SELECT count(*) FROM public.rides r
    WHERE r.admin_id = NEW.admin_id AND r.id <> NEW.id
      AND r.status NOT IN ('completed', 'archived')
  ) >= v_limit THEN
    RAISE EXCEPTION 'Active trip limit reached for your plan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_active_trip_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_active_trip_limit ON public.rides;
CREATE CONSTRAINT TRIGGER enforce_active_trip_limit
AFTER INSERT OR UPDATE OF admin_id, status ON public.rides
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_active_trip_limit();

CREATE OR REPLACE FUNCTION public.enforce_waypoint_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_limit integer;
BEGIN
  SELECT CASE WHEN p.subscription_tier = 'pro_tourer' THEN 50 ELSE 15 END
    INTO v_limit FROM public.rides r JOIN public.profiles p ON p.id = r.admin_id
   WHERE r.id = NEW.ride_id;
  IF v_limit IS NOT NULL AND (SELECT count(*) FROM public.trip_waypoints WHERE ride_id = NEW.ride_id) > v_limit THEN
    RAISE EXCEPTION 'Waypoint limit reached for your plan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_waypoint_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_waypoint_limit ON public.trip_waypoints;
CREATE CONSTRAINT TRIGGER enforce_waypoint_limit
AFTER INSERT OR UPDATE OF ride_id ON public.trip_waypoints
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_waypoint_limit();

-- Runnable retention boundary for Supabase Cron or any external scheduler.
-- Kept as SECURITY DEFINER so a cron role need not receive table privileges.
CREATE OR REPLACE FUNCTION public.purge_old_location_history(p_retention_days integer DEFAULT 90)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted bigint;
BEGIN
  IF p_retention_days < 7 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'Retention must be between 7 and 3650 days';
  END IF;
  DELETE FROM public.location_updates
   WHERE "timestamp" < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;
REVOKE ALL ON FUNCTION public.purge_old_location_history(integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.purge_old_location_history(integer) TO service_role;
  END IF;
END $$;

-- Only retain directory entries whose phone is part of the officially published
-- nationwide services used by the app. Region-specific/vendor numbers require a
-- verified source URL and review date before reintroduction.
DELETE FROM public.breakdown_assistance_directory;
INSERT INTO public.breakdown_assistance_directory (name, category, region, phone, notes, is_verified)
VALUES ('NHAI 24x7 National Highway Helpline', 'towing', 'All India', '1033',
        'Official NHAI emergency assistance number for incidents on national highways.', true);
CREATE OR REPLACE FUNCTION public.get_breakdown_assistance_directory(
  p_region text DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS SETOF public.breakdown_assistance_directory LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.breakdown_assistance_directory d
   WHERE d.is_verified
     AND (p_region IS NULL OR d.region ILIKE '%' || trim(p_region) || '%' OR d.region = 'All India')
     AND (p_category IS NULL OR d.category = p_category)
   ORDER BY d.name;
$$;
REVOKE ALL ON FUNCTION public.get_breakdown_assistance_directory(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_breakdown_assistance_directory(text, text) TO authenticated;

COMMIT;
