\set ON_ERROR_STOP on
-- F12: a voice message must point at its own ride/sender folder; free while
-- free_safety_features is on, Pro-only when it is off.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c1200000-0000-4000-8000-000000000001', 'vn1@example.test', '{"username":"voice_cap","display_name":"Voice Captain"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_uid uuid := 'c1200000-0000-4000-8000-000000000001'; v_clip uuid := 'c1200000-0000-4000-8000-0000000000c1';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  v_ride := public.create_trip_plan(
    '{"name":"Voice fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  INSERT INTO public.ride_messages (ride_id, sender_id, body, message_type, voice_path, voice_duration_ms, client_id)
  VALUES (v_ride, v_uid, 'Voice note', 'voice', v_ride::text || '/' || v_uid::text || '/' || v_clip::text || '.m4a', 8000, v_clip);
  BEGIN
    INSERT INTO public.ride_messages (ride_id, sender_id, body, message_type, voice_path, voice_duration_ms)
    VALUES (v_ride, v_uid, 'Voice note', 'voice', gen_random_uuid()::text || '/' || v_uid::text || '/' || gen_random_uuid()::text || '.m4a', 8000);
    RAISE EXCEPTION 'clip from another ride accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.ride_messages (ride_id, sender_id, body, message_type, voice_path, voice_duration_ms)
    VALUES (v_ride, v_uid, 'Voice note', 'voice', v_ride::text || '/' || v_uid::text || '/' || gen_random_uuid()::text || '.m4a', 60000);
    RAISE EXCEPTION 'over-long clip accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.ride_messages (ride_id, sender_id, body, message_type) VALUES (v_ride, v_uid, 'Voice note', 'voice');
    RAISE EXCEPTION 'voice without clip accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.app_flags SET enabled = false WHERE key = 'free_safety_features';
SET ROLE authenticated;
DO $$
DECLARE v_uid uuid := 'c1200000-0000-4000-8000-000000000001'; v_ride uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  SELECT id INTO v_ride FROM public.rides WHERE name = 'Voice fixture';
  BEGIN
    INSERT INTO public.ride_messages (ride_id, sender_id, body, message_type, voice_path, voice_duration_ms)
    VALUES (v_ride, v_uid, 'Voice note', 'voice', v_ride::text || '/' || v_uid::text || '/' || gen_random_uuid()::text || '.m4a', 5000);
    RAISE EXCEPTION 'voice allowed without Pro when safety is not free';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.app_flags SET enabled = true WHERE key = 'free_safety_features';
