\set ON_ERROR_STOP on
-- R4 analytics and flags. Runs after tests/db-regression.sql on the same database.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'fa1@example.test', '{"username":"found_a1","display_name":"Found A1"}'),
  ('a0000000-0000-4000-8000-000000000002', 'fa2@example.test', '{"username":"found_a2","display_name":"Found A2"}')
ON CONFLICT (id) DO NOTHING;

UPDATE public.app_flags SET allow_user_ids = ARRAY['a0000000-0000-4000-8000-000000000002'::uuid] WHERE key = 'crash_detection_beta';

SET ROLE authenticated;
DO $$
DECLARE v_n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
  v_n := public.log_app_events(jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'session_id', gen_random_uuid(), 'name', 'ride_started',
      'props', jsonb_build_object('step', 'start', 'lat', 32.1, 'phone_number', '9876543210', 'nested', jsonb_build_object('a', 1)),
      'occurred_at', now(), 'platform', 'android', 'app_version', '1.0.0')));
  IF v_n <> 1 THEN RAISE EXCEPTION 'event not logged'; END IF;

  -- Clients cannot read events back, not even their own.
  -- (RLS has no client policy, so even with table grants nothing is visible.)
  IF EXISTS (SELECT 1 FROM public.app_events) THEN RAISE EXCEPTION 'app_events readable by clients'; END IF;

  BEGIN
    PERFORM public.log_app_events((SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'session_id', gen_random_uuid(), 'name', 'app_opened')) FROM generate_series(1, 51)));
    RAISE EXCEPTION 'oversized batch accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- Flags: defaults apply, the allow list wins for its rider only.
  IF (SELECT enabled FROM public.get_my_flags() WHERE key = 'crash_detection_beta') THEN RAISE EXCEPTION 'beta enabled for everyone'; END IF;
  IF NOT (SELECT enabled FROM public.get_my_flags() WHERE key = 'free_safety_features') THEN RAISE EXCEPTION 'decision 3 default not applied'; END IF;
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
  IF NOT (SELECT enabled FROM public.get_my_flags() WHERE key = 'crash_detection_beta') THEN RAISE EXCEPTION 'allow list ignored'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_flags) THEN RAISE EXCEPTION 'app_flags readable by clients'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.app_events WHERE props ? 'lat' OR props ? 'phone_number' OR props ? 'nested') THEN
    RAISE EXCEPTION 'sensitive analytics props stored';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_events WHERE props->>'step' = 'start') THEN RAISE EXCEPTION 'safe prop dropped'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.log_app_events('[]'::jsonb);
    RAISE EXCEPTION 'anon logged events';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.app_flags SET allow_user_ids = '{}' WHERE key = 'crash_detection_beta';
