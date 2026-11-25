\set ON_ERROR_STOP on
-- F8: a queued message retried with the same client id is stored once; client
-- times are clamped to the past week and never the future.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c8000000-0000-4000-8000-000000000001', 'oc1@example.test', '{"username":"oc_captain","display_name":"OC Captain"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_client uuid := 'c8000000-0000-4000-8000-0000000000aa'; v_at timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c8000000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Chat fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  INSERT INTO public.ride_messages (ride_id, sender_id, body, client_id, client_created_at)
  VALUES (v_ride, auth.uid(), 'Stopping at the dhaba', v_client, now() - interval '20 minutes');
  INSERT INTO public.ride_messages (ride_id, sender_id, body, client_id, client_created_at)
  VALUES (v_ride, auth.uid(), 'Stopping at the dhaba', v_client, now() - interval '20 minutes')
  ON CONFLICT (client_id) DO NOTHING;
  IF (SELECT count(*) FROM public.ride_messages WHERE ride_id = v_ride) <> 1 THEN RAISE EXCEPTION 'retry duplicated a message'; END IF;
  SELECT client_created_at INTO v_at FROM public.ride_messages WHERE client_id = v_client;
  IF v_at > now() - interval '19 minutes' THEN RAISE EXCEPTION 'client time lost'; END IF;

  INSERT INTO public.ride_messages (ride_id, sender_id, body, client_id, client_created_at)
  VALUES (v_ride, auth.uid(), 'Future clock', gen_random_uuid(), now() + interval '3 hours') RETURNING client_created_at INTO v_at;
  IF v_at > now() THEN RAISE EXCEPTION 'future client time accepted'; END IF;
  INSERT INTO public.ride_messages (ride_id, sender_id, body) VALUES (v_ride, auth.uid(), 'Old client without ids') RETURNING client_created_at INTO v_at;
  IF v_at IS NULL THEN RAISE EXCEPTION 'client time not defaulted'; END IF;
END $$;
RESET ROLE;
