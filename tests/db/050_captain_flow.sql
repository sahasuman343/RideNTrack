\set ON_ERROR_STOP on
-- F1 captain flow: briefing, location roll call, start gate, sweep all-through, debrief.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'cf1@example.test', '{"username":"cf_captain","display_name":"CF Captain"}'),
  ('e0000000-0000-4000-8000-000000000002', 'cf2@example.test', '{"username":"cf_near","display_name":"CF Near"}'),
  ('e0000000-0000-4000-8000-000000000003', 'cf3@example.test', '{"username":"cf_far","display_name":"CF Far"}'),
  ('e0000000-0000-4000-8000-000000000004', 'cf4@example.test', '{"username":"cf_sweep","display_name":"CF Sweep"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_code text; v_point uuid; v_missing int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Captain fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_ride;

  -- Clients can no longer set status directly.
  BEGIN
    UPDATE public.rides SET status = 'active' WHERE id = v_ride;
    RAISE EXCEPTION 'direct status update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  IF public.publish_ride_briefing(v_ride, ARRAY['Left arm up: stop'], 'Fuel at km 40') <> 1 THEN RAISE EXCEPTION 'briefing version'; END IF;
  IF public.publish_ride_briefing(v_ride, ARRAY['Left arm up: stop'], 'Fuel at km 45') <> 2 THEN RAISE EXCEPTION 'briefing bump'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
  PERFORM public.join_ride_by_code(v_code);
  BEGIN
    PERFORM public.publish_ride_briefing(v_ride, '{}', 'hijack');
    RAISE EXCEPTION 'member published briefing';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.mark_briefing_read(v_ride, 2);
  IF (SELECT read_count FROM public.get_ride_briefing(v_ride)) <> 1 THEN RAISE EXCEPTION 'read not counted'; END IF;
  -- ~100 m from the origin, fresh fix: checked in by location.
  IF NOT public.report_roll_call_location(v_ride, 12.0009, 77, now(), 10) THEN RAISE EXCEPTION 'near rider not checked in'; END IF;
  BEGIN
    PERFORM public.start_ride(v_ride, 'me');
    RAISE EXCEPTION 'member started ride';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000003', true);
  PERFORM public.join_ride_by_code(v_code);
  IF public.report_roll_call_location(v_ride, 12.01, 77, now(), 10) THEN RAISE EXCEPTION 'far rider checked in'; END IF;
  IF public.report_roll_call_location(v_ride, 12.0001, 77, now() - interval '10 minutes', 10) THEN RAISE EXCEPTION 'stale fix accepted'; END IF;
  BEGIN
    PERFORM public.set_roll_call_status(v_ride, 'e0000000-0000-4000-8000-000000000002', 'absent');
    RAISE EXCEPTION 'member marked another rider';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000004', true);
  PERFORM public.join_ride_by_code(v_code);

  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
  PERFORM public.set_trip_participant_role(v_ride, 'e0000000-0000-4000-8000-000000000004', 'sweeper');
  PERFORM public.set_roll_call_status(v_ride, 'e0000000-0000-4000-8000-000000000004', 'checked_in');
  IF (SELECT checked_in_by FROM public.get_roll_call(v_ride) WHERE user_id = 'e0000000-0000-4000-8000-000000000002') <> 'location' THEN
    RAISE EXCEPTION 'location check-in not labelled';
  END IF;
  BEGIN
    PERFORM public.start_ride(v_ride, NULL);
    RAISE EXCEPTION 'started with riders waiting';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Roll call not finished: 1 rider%' THEN RAISE; END IF;
  END;
  PERFORM public.start_ride(v_ride, 'Late riders will catch up');
  IF (SELECT status FROM public.rides WHERE id = v_ride) <> 'active' THEN RAISE EXCEPTION 'ride not started'; END IF;
  IF (SELECT start_override_reason FROM public.rides WHERE id = v_ride) IS NULL THEN RAISE EXCEPTION 'override not recorded'; END IF;

  v_point := public.add_regroup_point(v_ride, 'Chai stop', 12.5, 77.5, 1, NULL, NULL);
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
  PERFORM public.confirm_regroup_arrival(v_point);
  BEGIN
    PERFORM public.mark_regroup_all_through(v_point);
    RAISE EXCEPTION 'member marked all through';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000004', true);
  SELECT count(*) INTO v_missing FROM public.mark_regroup_all_through(v_point);
  -- Captain and CF Far did not confirm; the sweep is not counted.
  IF v_missing <> 2 THEN RAISE EXCEPTION 'expected 2 missing, got %', v_missing; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
  PERFORM public.end_ride(v_ride);
  IF jsonb_array_length(public.get_debrief_inputs(v_ride)->'regroups_missing') <> 1 THEN RAISE EXCEPTION 'debrief missing regroup'; END IF;
  PERFORM public.save_ride_debrief(v_ride, '120 km · 3 riders', ARRAY['No alerts raised.'], 'Great ride');
  IF (public.get_debrief_inputs(v_ride)->'debrief'->>'notes') <> 'Great ride' THEN RAISE EXCEPTION 'debrief not saved'; END IF;
  PERFORM public.delete_trip(v_ride);
END $$;
RESET ROLE;
