-- Beta testing without payments: while `beta_free_pro` is on, every ride
-- gets Pro limits and every rider the Pro active-trip cap. Turn it off before
-- charging. No subscription rows are written, so turning it off is clean.

INSERT INTO public.app_flags (key, description, enabled) VALUES
  ('beta_free_pro', 'Beta: everyone gets Pro limits for free (no payments)', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ride_has_pro_access(p_ride_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.flag_enabled('beta_free_pro')
  OR EXISTS (
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
  )
  OR EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.id = p_ride_id AND r.club_id IS NOT NULL AND public.club_plan_active(r.club_id)
  );
$$;

-- Definer so the trigger can read the flag (flag_enabled is not granted to riders).
CREATE OR REPLACE FUNCTION public.enforce_active_trip_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_limit integer;
BEGIN
  IF NEW.status IN ('completed', 'archived') THEN RETURN NEW; END IF;
  SELECT CASE WHEN p.subscription_tier = 'pro_tourer' OR public.flag_enabled('beta_free_pro') THEN 100 ELSE 5 END
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
