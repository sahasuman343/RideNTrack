\set ON_ERROR_STOP on
-- F2 family updates: contacts with consent, three server events, free family links.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'fu1@example.test', '{"username":"fu_captain","display_name":"FU Captain"}'),
  ('f0000000-0000-4000-8000-000000000002', 'fu2@example.test', '{"username":"fu_rider","display_name":"FU Rider"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_code text; v_token text; v_contact uuid; v_snap jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Family fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, '{"name":"River camp","stay_type":"camping","latitude":12.5,"longitude":77.5}'::jsonb);
  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_ride;

  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000002', true);
  PERFORM public.join_ride_by_code(v_code);
  BEGIN
    PERFORM public.save_family_contact(NULL, 'Amma', '98765 43210', 'Mother');
    RAISE EXCEPTION 'unnormalised phone accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_contact := public.save_family_contact(NULL, 'Amma', '+919876543210', 'Mother');
  PERFORM public.save_family_contact(NULL, 'Appa', '+919876543211', NULL);
  BEGIN
    PERFORM public.save_family_contact(NULL, 'Third', '+919876543212', NULL);
    RAISE EXCEPTION 'third contact accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.family_contacts) <> 2 THEN RAISE EXCEPTION 'rider cannot see own contacts'; END IF;

  -- Free family link (decision 3) even though the ride has no Pro.
  v_token := public.create_family_link(v_ride);
  IF length(v_token) < 16 THEN RAISE EXCEPTION 'no family link'; END IF;
  IF public.create_family_link(v_ride) <> v_token THEN RAISE EXCEPTION 'family link not reused'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);
  IF EXISTS (SELECT 1 FROM public.family_contacts) THEN RAISE EXCEPTION 'captain sees rider family contacts'; END IF;
  PERFORM public.start_ride(v_ride, 'fixture');

  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000002', true);
  IF (SELECT count(*) FROM public.get_outbound_status(v_ride) WHERE template = 'family_ride_started') <> 2 THEN
    RAISE EXCEPTION 'ride start did not queue two family messages';
  END IF;
  INSERT INTO public.location_updates (ride_id, user_id, lat, lng, timestamp) VALUES (v_ride, auth.uid(), 12.501, 77.5, now());
  INSERT INTO public.location_updates (ride_id, user_id, lat, lng, timestamp) VALUES (v_ride, auth.uid(), 12.5005, 77.5, now());
  IF (SELECT count(*) FROM public.get_outbound_status(v_ride) WHERE template = 'family_reached_stay') <> 2 THEN
    RAISE EXCEPTION 'stay arrival should queue exactly once per contact';
  END IF;

  PERFORM public.set_family_updates_paused(true);
  INSERT INTO public.alerts (ride_id, user_id, type, message) VALUES (v_ride, auth.uid(), 'check_in_missed', 'No answer');
  IF EXISTS (SELECT 1 FROM public.get_outbound_status(v_ride) WHERE template = 'family_check_in_missed') THEN
    RAISE EXCEPTION 'paused contacts still messaged';
  END IF;
  PERFORM public.set_family_updates_paused(false);
  INSERT INTO public.alerts (ride_id, user_id, type, message) VALUES (v_ride, auth.uid(), 'check_in_missed', 'No answer');
  IF (SELECT count(*) FROM public.get_outbound_status(v_ride) WHERE template = 'family_check_in_missed') <> 2 THEN
    RAISE EXCEPTION 'missed check-in not queued';
  END IF;

  v_snap := public.get_public_ride_snapshot(v_token);
  IF v_snap->'subject'->>'display_name' <> 'FU Rider' THEN RAISE EXCEPTION 'snapshot subject missing'; END IF;
  IF jsonb_array_length(v_snap->'stays') <> 1 THEN RAISE EXCEPTION 'snapshot stays missing'; END IF;
  IF public.revoke_my_family_links(v_ride) < 1 THEN RAISE EXCEPTION 'revoke failed'; END IF;
  IF public.get_public_ride_snapshot(v_token) IS NOT NULL THEN RAISE EXCEPTION 'revoked link still works'; END IF;

  PERFORM public.delete_family_contact(v_contact);
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);
  PERFORM public.end_ride(v_ride);
  PERFORM public.delete_trip(v_ride);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.notify_family(uuid,uuid,text,jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'notify_family callable'; END IF;
  IF has_function_privilege('authenticated', 'public.family_link_token(uuid,uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'family_link_token callable'; END IF;
END $$;
