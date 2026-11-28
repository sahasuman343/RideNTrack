\set ON_ERROR_STOP on
-- Phone sign-in: phone-only accounts get a profile, and sign-in codes have
-- their own caps that never touch the outbound (SOS) budget.
RESET ROLE;

-- An account created by phone has no email. With sign-up metadata it keeps
-- the chosen username; without any, it still gets a profile.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c2600000-0000-4000-8000-000000000001', NULL, '{"username":"phone_rider","display_name":"Phone Rider"}'),
  ('c2600000-0000-4000-8000-000000000002', NULL, '{}');
DO $$
BEGIN
  IF (SELECT username FROM public.profiles WHERE id = 'c2600000-0000-4000-8000-000000000001') <> 'phone_rider' THEN
    RAISE EXCEPTION 'phone sign-up lost its username';
  END IF;
  IF (SELECT username || '/' || display_name FROM public.profiles WHERE id = 'c2600000-0000-4000-8000-000000000002') <> 'rider_c260000000/Rider' THEN
    RAISE EXCEPTION 'phone account without metadata got no fallback profile: %', (SELECT username FROM public.profiles WHERE id = 'c2600000-0000-4000-8000-000000000002');
  END IF;
END $$;

-- Riders and the public can't read or spend the code caps.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.claim_auth_sms(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_auth_sms(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.release_auth_sms(text)', 'EXECUTE')
     -- Tables: RLS on with no policies, so even a broad grant returns nothing.
     OR NOT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.auth_sms_log'::regclass, 'public.auth_sms_limits'::regclass))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('auth_sms_log', 'auth_sms_limits')) THEN
    RAISE EXCEPTION 'sign-in code caps are reachable by clients';
  END IF;
END $$;

DELETE FROM public.auth_sms_log;
DELETE FROM public.outbound_messages;
UPDATE public.auth_sms_limits SET per_phone_hourly = 2, per_phone_daily = 3, global_daily = 5 WHERE id;
DO $$
DECLARE r text;
BEGIN
  IF public.claim_auth_sms('+44 7700 900123') IS DISTINCT FROM 'country_not_allowed' THEN RAISE EXCEPTION 'non-Indian number allowed'; END IF;
  IF public.claim_auth_sms('12') IS DISTINCT FROM 'invalid_phone' THEN RAISE EXCEPTION 'bad number allowed'; END IF;

  -- Same number in two spellings counts once per send.
  IF public.claim_auth_sms('+919876543210') IS NOT NULL THEN RAISE EXCEPTION 'first code refused'; END IF;
  IF public.claim_auth_sms('919876543210') IS NOT NULL THEN RAISE EXCEPTION 'second code refused'; END IF;
  IF public.claim_auth_sms('+91 98765 43210') IS DISTINCT FROM 'phone_hourly_cap' THEN RAISE EXCEPTION 'hourly cap not applied'; END IF;

  -- A failed send gives the code back.
  PERFORM public.release_auth_sms('+919876543210');
  IF public.claim_auth_sms('+919876543210') IS NOT NULL THEN RAISE EXCEPTION 'released code not returned'; END IF;

  -- Older sends still count for the daily cap.
  UPDATE public.auth_sms_log SET sent_at = now() - interval '2 hours';
  IF public.claim_auth_sms('+919876543210') IS NOT NULL THEN RAISE EXCEPTION 'code refused after the hour passed'; END IF;
  IF public.claim_auth_sms('+919876543210') IS DISTINCT FROM 'phone_daily_cap' THEN RAISE EXCEPTION 'daily cap not applied'; END IF;

  -- Global cap: 3 sent so far, 2 more for other numbers, then stop.
  IF public.claim_auth_sms('+919000000001') IS NOT NULL THEN RAISE EXCEPTION 'other number refused'; END IF;
  IF public.claim_auth_sms('+919000000002') IS NOT NULL THEN RAISE EXCEPTION 'other number refused'; END IF;
  IF public.claim_auth_sms('+919000000003') IS DISTINCT FROM 'global_daily_cap' THEN RAISE EXCEPTION 'global cap not applied'; END IF;

  -- Rows past two days are cleared.
  UPDATE public.auth_sms_log SET sent_at = now() - interval '3 days';
  IF public.claim_auth_sms('+919000000003') IS NOT NULL THEN RAISE EXCEPTION 'old rows still counted'; END IF;
  IF (SELECT count(*) FROM public.auth_sms_log) <> 1 THEN RAISE EXCEPTION 'old rows kept'; END IF;

  -- None of this touched the outbound (SOS / family) queue or its budget.
  IF EXISTS (SELECT 1 FROM public.outbound_messages) THEN RAISE EXCEPTION 'sign-in codes used the outbound queue'; END IF;
END $$;

DELETE FROM public.auth_sms_log;
UPDATE public.auth_sms_limits SET per_phone_hourly = 5, per_phone_daily = 10, global_daily = 2000 WHERE id;
