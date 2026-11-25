\set ON_ERROR_STOP on
-- R5 Ride ready: members report, captains see all, others see only themselves.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'rr1@example.test', '{"username":"rr_captain","display_name":"RR Captain"}'),
  ('c0000000-0000-4000-8000-000000000002', 'rr2@example.test', '{"username":"rr_rider","display_name":"RR Rider"}'),
  ('c0000000-0000-4000-8000-000000000003', 'rr3@example.test', '{"username":"rr_outsider","display_name":"RR Outsider"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_code text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Ready fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_ride;
  PERFORM public.report_ride_readiness(v_ride, ARRAY['bike_model'], true);

  PERFORM set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);
  PERFORM public.join_ride_by_code(v_code);
  PERFORM public.report_ride_readiness(v_ride, ARRAY['emergency_contact', 'not_a_real_item', 'emergency_contact'], false);
  IF (SELECT missing FROM public.get_ride_readiness(v_ride)) <> ARRAY['emergency_contact'] THEN RAISE EXCEPTION 'missing list not cleaned'; END IF;
  IF (SELECT count(*) FROM public.get_ride_readiness(v_ride)) <> 1 THEN RAISE EXCEPTION 'rider saw other riders readiness'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
  BEGIN
    PERFORM public.report_ride_readiness(v_ride, '{}', true);
    RAISE EXCEPTION 'outsider reported readiness';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.get_ride_readiness(v_ride)) THEN RAISE EXCEPTION 'outsider saw readiness'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
  IF (SELECT count(*) FROM public.get_ride_readiness(v_ride)) <> 2 THEN RAISE EXCEPTION 'captain cannot see the pack'; END IF;
  PERFORM public.delete_trip(v_ride);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'unexpected privilege error: %', SQLERRM;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.ride_member_role(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ride_member_role is callable by clients';
  END IF;
END $$;
