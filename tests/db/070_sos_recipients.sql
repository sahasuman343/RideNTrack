\set ON_ERROR_STOP on
-- F6: SOS recipients respect phone consent; server SMS queues for the SOS owner only.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'sos1@example.test', '{"username":"sos_captain","display_name":"SOS Captain"}'),
  ('a1000000-0000-4000-8000-000000000002', 'sos2@example.test', '{"username":"sos_rider","display_name":"SOS Rider"}'),
  ('a1000000-0000-4000-8000-000000000003', 'sos3@example.test', '{"username":"sos_sweep","display_name":"SOS Sweep"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_code text; v_alert uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
  UPDATE public.profiles SET phone = '98765 00001', share_phone_with_ride = true WHERE id = auth.uid();
  IF (SELECT phone_consent_at FROM public.profiles WHERE id = auth.uid()) IS NULL THEN RAISE EXCEPTION 'consent not stamped'; END IF;
  v_ride := public.create_trip_plan(
    '{"name":"SOS fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_ride;

  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
  UPDATE public.profiles SET phone = '98765 00003', share_phone_with_ride = false WHERE id = auth.uid();
  PERFORM public.join_ride_by_code(v_code);

  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
  PERFORM public.set_trip_participant_role(v_ride, 'a1000000-0000-4000-8000-000000000003', 'sweeper');

  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
  UPDATE public.profiles SET emergency_contact = '+91 90000 11111' WHERE id = auth.uid();
  PERFORM public.join_ride_by_code(v_code);
  -- Sweep has not opted in, so only the emergency contact and the captain.
  IF (SELECT count(*) FROM public.get_ride_sos_recipients(v_ride)) <> 2 THEN RAISE EXCEPTION 'consent not respected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_ride_sos_recipients(v_ride) WHERE role = 'captain' AND phone = '98765 00001') THEN RAISE EXCEPTION 'captain missing'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
  UPDATE public.profiles SET share_phone_with_ride = true WHERE id = auth.uid();
  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
  IF (SELECT count(*) FROM public.get_ride_sos_recipients(v_ride)) <> 3 THEN RAISE EXCEPTION 'sweep not added after consent'; END IF;

  INSERT INTO public.alerts (ride_id, user_id, type, message) VALUES (v_ride, auth.uid(), 'emergency', 'help') RETURNING id INTO v_alert;
  IF public.request_sos_sms(v_alert) <> 3 THEN RAISE EXCEPTION 'server SMS not queued for 3'; END IF;
  IF public.request_sos_sms(v_alert) <> 3 THEN RAISE EXCEPTION 'retry should be idempotent'; END IF;
  IF (SELECT count(*) FROM public.get_outbound_status(v_ride) WHERE template = 'sos_alert') <> 3 THEN RAISE EXCEPTION 'duplicate SOS SMS'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
  BEGIN
    PERFORM public.request_sos_sms(v_alert);
    RAISE EXCEPTION 'another rider triggered SMS for my SOS';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
  PERFORM public.delete_trip(v_ride);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF public.to_e164('98765 43210') <> '+919876543210' OR public.to_e164('+44 7700 900123') <> '+447700900123' OR public.to_e164('123') IS NOT NULL THEN
    RAISE EXCEPTION 'to_e164 wrong';
  END IF;
END $$;
