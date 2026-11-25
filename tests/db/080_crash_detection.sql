\set ON_ERROR_STOP on
-- F7 crash detection: crash alerts without a fix, family hears only crash_detected,
-- telemetry needs consent for motion samples, withdrawing consent wipes samples.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c7000000-0000-4000-8000-000000000001', 'cd1@example.test', '{"username":"cd_captain","display_name":"CD Captain"}'),
  ('c7000000-0000-4000-8000-000000000002', 'cd2@example.test', '{"username":"cd_rider","display_name":"CD Rider"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_code text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Crash fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_ride;

  PERFORM set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000002', true);
  PERFORM public.join_ride_by_code(v_code);
  PERFORM public.save_family_contact(NULL, 'Amma', '+919811111111', 'Mother');

  PERFORM set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
  PERFORM public.start_ride(v_ride, 'fixture');

  PERFORM set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000002', true);
  -- The countdown and a cancel tell the pack only.
  INSERT INTO public.alerts (ride_id, user_id, type, message) VALUES (v_ride, auth.uid(), 'possible_crash', 'Possible crash, confirming.');
  INSERT INTO public.alerts (ride_id, user_id, type, message) VALUES (v_ride, auth.uid(), 'crash_cancelled', 'I am OK.');
  IF EXISTS (SELECT 1 FROM public.get_outbound_status(v_ride) WHERE template = 'family_crash') THEN
    RAISE EXCEPTION 'family told about a cancelled crash check';
  END IF;
  -- Countdown ran out: family hears, once per contact.
  INSERT INTO public.alerts (ride_id, user_id, type, message) VALUES (v_ride, auth.uid(), 'crash_detected', 'No answer to the crash check.');
  IF (SELECT count(*) FROM public.get_outbound_status(v_ride) WHERE template = 'family_crash') <> 1 THEN
    RAISE EXCEPTION 'family not told about a detected crash';
  END IF;

  -- Feedback without samples needs no consent; samples do.
  INSERT INTO public.crash_telemetry (user_id, ride_id, kind, peak_g) VALUES (auth.uid(), v_ride, 'false_alarm', 5.1);
  BEGIN
    INSERT INTO public.crash_telemetry (user_id, ride_id, kind, peak_g, samples) VALUES (auth.uid(), v_ride, 'hard_event', 3.0, '[{"t":1,"g":3}]');
    RAISE EXCEPTION 'samples stored without consent';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF public.set_crash_research_consent(true) IS NULL THEN RAISE EXCEPTION 'consent not stamped'; END IF;
  INSERT INTO public.crash_telemetry (user_id, ride_id, kind, peak_g, samples) VALUES (auth.uid(), v_ride, 'hard_event', 3.0, '[{"t":1,"g":3}]');
  BEGIN
    INSERT INTO public.crash_telemetry (user_id, kind, peak_g) VALUES ('c7000000-0000-4000-8000-000000000001', 'false_alarm', 1);
    RAISE EXCEPTION 'telemetry written for another rider';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
  IF EXISTS (SELECT 1 FROM public.crash_telemetry) THEN RAISE EXCEPTION 'captain reads rider telemetry'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000002', true);
  PERFORM public.set_crash_research_consent(false);
  IF (SELECT count(*) FROM public.crash_telemetry) <> 1 THEN RAISE EXCEPTION 'withdrawing consent kept samples or lost feedback'; END IF;
END $$;
RESET ROLE;
