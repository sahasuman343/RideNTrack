\set ON_ERROR_STOP on
-- beta_free_pro: every ride has Pro access while the flag is on; off restores free limits.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1700000-0000-4000-8000-000000000001', 'beta1@example.test', '{"username":"beta_captain","display_name":"Beta Captain"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1700000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Beta fixture","trip_type":"group","visibility":"private","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb, '[]'::jsonb, NULL);
  PERFORM set_config('test.beta_ride', v_ride::text, false);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF public.ride_has_pro_access(current_setting('test.beta_ride')::uuid) THEN RAISE EXCEPTION 'free ride had Pro with the flag off'; END IF;
END $$;
UPDATE public.app_flags SET enabled = true, rollout_percent = 100 WHERE key = 'beta_free_pro';
DO $$ BEGIN
  IF NOT public.ride_has_pro_access(current_setting('test.beta_ride')::uuid) THEN RAISE EXCEPTION 'beta_free_pro did not grant Pro'; END IF;
END $$;
-- The active-trip trigger runs as a rider and must still read the flag.
SET ROLE authenticated;
DO $$
DECLARE i int; v uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1700000-0000-4000-8000-000000000001', true);
  FOR i IN 1..6 LOOP
    v := public.create_trip_plan(
      '{"name":"Beta extra","trip_type":"group","visibility":"private","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
      '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb, '[]'::jsonb, NULL);
  END LOOP;
END $$;
RESET ROLE;
UPDATE public.app_flags SET enabled = false WHERE key = 'beta_free_pro';
DO $$ BEGIN
  IF public.ride_has_pro_access(current_setting('test.beta_ride')::uuid) THEN RAISE EXCEPTION 'Pro stayed after the flag went off'; END IF;
END $$;
