\set ON_ERROR_STOP on
-- F11: expiry and confirmations, rate limit, idempotent retries, RLS, captain hide.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c1100000-0000-4000-8000-000000000001', 'road1@example.test', '{"username":"road_cap","display_name":"RR Captain"}'),
  ('c1100000-0000-4000-8000-000000000002', 'road2@example.test', '{"username":"road_rider","display_name":"RR Rider"}'),
  ('c1100000-0000-4000-8000-000000000003', 'road3@example.test', '{"username":"road_stranger","display_name":"RR Stranger"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_code text; v_r uuid := 'c1100000-0000-4000-8000-0000000000a1'; v_exp1 timestamptz; v_exp2 timestamptz; i int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c1100000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Road fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_ride;

  PERFORM set_config('request.jwt.claim.sub', 'c1100000-0000-4000-8000-000000000002', true);
  PERFORM public.join_ride_by_code(v_code);
  PERFORM public.create_road_report(v_r, 'landslide', 12.5, 77.5, 'Debris on left lane', v_ride);
  IF public.create_road_report(v_r, 'landslide', 12.5, 77.5, 'Debris on left lane', v_ride) <> v_r THEN RAISE EXCEPTION 'retry not idempotent'; END IF;
  -- No policies: direct reads see nothing (and production revokes the grant too).
  BEGIN
    IF EXISTS (SELECT 1 FROM public.road_reports) THEN RAISE EXCEPTION 'direct table read allowed'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT expires_at INTO v_exp1 FROM public.get_road_reports_in_bbox(77, 12, 78, 13) WHERE id = v_r;
  IF v_exp1 < now() + interval '47 hours' THEN RAISE EXCEPTION 'default expiry not 48 h'; END IF;
  -- Own report: confirming does nothing.
  IF public.confirm_road_report(v_r) <> v_exp1 THEN RAISE EXCEPTION 'self-confirm extended'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'c1100000-0000-4000-8000-000000000003', true);
  BEGIN
    PERFORM public.create_road_report(gen_random_uuid(), 'pothole', 12.6, 77.6, NULL, v_ride);
    RAISE EXCEPTION 'stranger reported into a ride';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  v_exp2 := public.confirm_road_report(v_r);
  IF v_exp2 < v_exp1 + interval '23 hours' THEN RAISE EXCEPTION 'confirm did not extend'; END IF;
  IF public.confirm_road_report(v_r) <> v_exp2 THEN RAISE EXCEPTION 'double confirm extended'; END IF;
  IF (SELECT confirm_count FROM public.get_road_reports_in_bbox(77, 12, 78, 13) WHERE id = v_r) <> 1 THEN RAISE EXCEPTION 'confirm count'; END IF;
  BEGIN
    PERFORM public.hide_road_report(v_ride, v_r);
    RAISE EXCEPTION 'stranger hid a report';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Rate limit: 10 an hour.
  FOR i IN 1..10 LOOP PERFORM public.create_road_report(gen_random_uuid(), 'pothole', 12.6, 77.6 + i * 0.001); END LOOP;
  BEGIN
    PERFORM public.create_road_report(gen_random_uuid(), 'pothole', 12.7, 77.7);
    RAISE EXCEPTION 'rate limit missing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Too many%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', 'c1100000-0000-4000-8000-000000000001', true);
  PERFORM public.hide_road_report(v_ride, v_r);
  IF EXISTS (SELECT 1 FROM public.get_road_reports_in_bbox(77, 12, 78, 13, v_ride) WHERE id = v_r) THEN RAISE EXCEPTION 'hidden report shown in ride'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_road_reports_in_bbox(77, 12, 78, 13) WHERE id = v_r) THEN RAISE EXCEPTION 'hide leaked outside the ride'; END IF;
END $$;
-- Expired reports disappear.
RESET ROLE;
UPDATE public.road_reports SET expires_at = now() - interval '1 minute' WHERE id = 'c1100000-0000-4000-8000-0000000000a1';
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c1100000-0000-4000-8000-000000000002', true);
  IF EXISTS (SELECT 1 FROM public.get_road_reports_in_bbox(77, 12, 78, 13) WHERE id = 'c1100000-0000-4000-8000-0000000000a1') THEN RAISE EXCEPTION 'expired report shown'; END IF;
END $$;
RESET ROLE;
