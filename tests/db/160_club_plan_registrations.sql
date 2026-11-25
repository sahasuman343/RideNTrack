\set ON_ERROR_STOP on
-- F16: club plan unlocks Pro for club rides; paid registration via webhook only.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1600000-0000-4000-8000-000000000001', 'cp1@example.test', '{"username":"cp_captain","display_name":"CP Captain"}'),
  ('f1600000-0000-4000-8000-000000000002', 'cp2@example.test', '{"username":"cp_rider","display_name":"CP Rider"}')
ON CONFLICT (id) DO NOTHING;
UPDATE public.app_flags SET enabled = true, rollout_percent = 100 WHERE key = 'paid_registrations';
SET ROLE authenticated;
DO $$
DECLARE v_club uuid; v_ride uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1600000-0000-4000-8000-000000000001', true);
  v_club := public.create_club('Plan Fixture Club', 'plan-fixture', NULL, NULL);
  v_ride := public.create_trip_plan(
    '{"name":"Paid fixture","trip_type":"group","visibility":"public","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  PERFORM public.set_ride_club(v_ride, v_club);
  IF public.ride_has_pro_access(v_ride) THEN RAISE EXCEPTION 'free ride already has Pro'; END IF;
  PERFORM public.set_ride_registration(v_ride, 1500, 2, 'Covers the stay and the support jeep');
  IF (SELECT registration_fee_paise FROM public.rides WHERE id = v_ride) <> 150000 THEN RAISE EXCEPTION 'fee not stored in paise'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'f1600000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.set_ride_registration(v_ride, 1, NULL, NULL);
    RAISE EXCEPTION 'rider set a fee';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.apply_registration_payment('evt', gen_random_uuid(), 'paid', 'pay', 150000);
    RAISE EXCEPTION 'rider marked a payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (public.get_ride_registration_summary(v_ride)->>'fee_paise')::int <> 150000 THEN RAISE EXCEPTION 'summary missing fee'; END IF;
  IF public.get_ride_registration_summary(v_ride) ? 'collected_paise' AND public.get_ride_registration_summary(v_ride)->>'collected_paise' IS NOT NULL THEN
    RAISE EXCEPTION 'rider sees money collected';
  END IF;
  PERFORM set_config('test.cp_ride', v_ride::text, false);
  PERFORM set_config('test.cp_club', v_club::text, false);
END $$;

-- The server side (service role here: the owner role).
RESET ROLE;
DO $$
DECLARE v_ride uuid := current_setting('test.cp_ride')::uuid; v_club uuid := current_setting('test.cp_club')::uuid; v_reg jsonb; v_again jsonb; v_id uuid;
BEGIN
  v_reg := public.begin_ride_registration(v_ride, 'f1600000-0000-4000-8000-000000000002');
  v_id := (v_reg->>'id')::uuid;
  PERFORM public.attach_registration_link(v_id, 'plink_1', 'https://rzp.io/i/abc');
  v_again := public.begin_ride_registration(v_ride, 'f1600000-0000-4000-8000-000000000002');
  IF (v_again->>'id')::uuid <> v_id OR v_again->>'payment_link_url' <> 'https://rzp.io/i/abc' THEN RAISE EXCEPTION 'second tap made a new registration'; END IF;

  IF public.apply_registration_payment('evt_1', v_id, 'paid', 'pay_1', 100) <> 'amount_mismatch' THEN RAISE EXCEPTION 'wrong amount accepted'; END IF;
  IF public.apply_registration_payment('evt_2', v_id, 'paid', 'pay_1', 150000) <> 'paid' THEN RAISE EXCEPTION 'payment not applied'; END IF;
  IF public.apply_registration_payment('evt_2', v_id, 'paid', 'pay_1', 150000) <> 'duplicate' THEN RAISE EXCEPTION 'webhook retry not idempotent'; END IF;
  IF public.apply_registration_payment('evt_3', v_id, 'failed', NULL, NULL) <> 'already_paid' THEN RAISE EXCEPTION 'late failure overwrote payment'; END IF;
  IF NOT public.is_ride_participant(v_ride, 'f1600000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'paid rider not added to ride'; END IF;

  -- Club plan: buyer must manage the club; active plan unlocks Pro for club rides.
  BEGIN
    PERFORM public.apply_club_plan('rc_0', 'f1600000-0000-4000-8000-000000000002', v_club, true, now() + interval '30 days');
    RAISE EXCEPTION 'non-admin bought a club plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT public.apply_club_plan('rc_1', 'f1600000-0000-4000-8000-000000000001', v_club, true, now() + interval '30 days') THEN RAISE EXCEPTION 'plan not applied'; END IF;
  IF public.apply_club_plan('rc_1', 'f1600000-0000-4000-8000-000000000001', v_club, true, now() + interval '30 days') THEN RAISE EXCEPTION 'plan event not idempotent'; END IF;
  IF NOT public.ride_has_pro_access(v_ride) THEN RAISE EXCEPTION 'club plan did not unlock Pro'; END IF;
  PERFORM public.apply_club_plan('rc_2', 'f1600000-0000-4000-8000-000000000001', v_club, false, now());
  IF public.ride_has_pro_access(v_ride) THEN RAISE EXCEPTION 'expired plan still unlocks Pro'; END IF;
END $$;

SET ROLE authenticated;
DO $$
DECLARE v_ride uuid := current_setting('test.cp_ride')::uuid; s jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1600000-0000-4000-8000-000000000001', true);
  s := public.get_ride_registration_summary(v_ride);
  IF (s->>'paid_count')::int <> 1 OR (s->>'collected_paise')::int <> 150000 THEN RAISE EXCEPTION 'captain summary wrong: %', s; END IF;
  BEGIN
    PERFORM public.set_ride_registration(v_ride, 2000, 2, NULL);
    RAISE EXCEPTION 'fee changed after payment';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', 'f1600000-0000-4000-8000-000000000002', true);
  IF public.get_ride_registration_summary(v_ride)->>'my_status' <> 'paid' THEN RAISE EXCEPTION 'rider does not see paid'; END IF;
  IF EXISTS (SELECT 1 FROM public.ride_registrations WHERE user_id <> auth.uid()) THEN RAISE EXCEPTION 'rider sees others'' registrations'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.begin_ride_registration(uuid,uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'begin_ride_registration callable'; END IF;
  IF has_function_privilege('authenticated', 'public.apply_club_plan(text,uuid,uuid,boolean,timestamptz)', 'EXECUTE') THEN RAISE EXCEPTION 'apply_club_plan callable'; END IF;
END $$;
UPDATE public.app_flags SET enabled = false WHERE key = 'paid_registrations';
