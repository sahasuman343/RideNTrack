\set ON_ERROR_STOP on
-- F15 clubs: roster, roles, verified badge, rides in a club, series, public page.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1500000-0000-4000-8000-000000000001', 'club1@example.test', '{"username":"club_owner","display_name":"Club Owner"}'),
  ('f1500000-0000-4000-8000-000000000002', 'club2@example.test', '{"username":"club_member","display_name":"Club Member"}'),
  ('f1500000-0000-4000-8000-000000000003', 'club3@example.test', '{"username":"club_outsider","display_name":"Club Outsider"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_club uuid; v_ride uuid; v_series uuid; v_next uuid; v_code text; v_club_json jsonb; v_public jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1500000-0000-4000-8000-000000000001', true);
  BEGIN
    PERFORM public.create_club('Bad', 'No Spaces!', NULL, NULL);
    RAISE EXCEPTION 'bad slug accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_club := public.create_club('Deccan Dawn Riders', 'deccan-dawn', 'Pune', 'Sunday breakfast rides.', 'code');
  IF public.club_role(v_club, auth.uid()) <> 'owner' THEN RAISE EXCEPTION 'creator not owner'; END IF;
  BEGIN
    PERFORM public.create_club('Dup', 'deccan-dawn', NULL, NULL);
    RAISE EXCEPTION 'duplicate slug accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Riders cannot verify their own club.
  BEGIN
    UPDATE public.clubs SET verified = true WHERE id = v_club;
    IF (SELECT verified FROM public.clubs WHERE id = v_club) THEN RAISE EXCEPTION 'rider verified own club'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  v_code := public.get_club_join_code(v_club);
  v_ride := public.create_trip_plan(
    '{"name":"Sinhagad dawn","trip_type":"group","visibility":"public","origin":"Pune","destination":"Sinhagad","origin_coords":[73.85,18.52],"destination_coords":[73.75,18.36],"start_date":"2099-01-04"}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Pune","latitude":18.52,"longitude":73.85},{"sequence":1,"waypoint_type":"destination","name":"Sinhagad","latitude":18.36,"longitude":73.75}]'::jsonb,
    '[]'::jsonb, NULL);
  PERFORM public.set_ride_club(v_ride, v_club);
  v_series := public.create_club_series(v_club, 'Sunday dawn ride', 'FREQ=WEEKLY;BYDAY=SU', v_ride);
  v_next := public.schedule_series_ride(v_series, '2099-01-11');
  IF (SELECT club_id FROM public.rides WHERE id = v_next) IS DISTINCT FROM v_club THEN RAISE EXCEPTION 'series ride not in club'; END IF;
  BEGIN
    PERFORM public.schedule_series_ride(v_series, '2099-01-11');
    RAISE EXCEPTION 'same date scheduled twice';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM set_config('test.club_code', v_code, false);
  PERFORM set_config('test.club_id', v_club::text, false);

  -- Members join with the code; outsiders see the club but not the roster.
  PERFORM set_config('request.jwt.claim.sub', 'f1500000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.join_club('deccan-dawn', 'WRONG1');
    RAISE EXCEPTION 'joined without the code';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.join_club('DECCAN-DAWN', lower(v_code));
  v_club_json := public.get_club('deccan-dawn');
  IF v_club_json->>'my_role' <> 'member' OR jsonb_array_length(v_club_json->'members') <> 2 THEN RAISE EXCEPTION 'member view wrong: %', v_club_json; END IF;
  BEGIN
    PERFORM public.set_ride_club(v_ride, NULL);
    RAISE EXCEPTION 'member detached a club ride';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_club_join_code(v_club);
    RAISE EXCEPTION 'member read the join code';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'f1500000-0000-4000-8000-000000000003', true);
  v_club_json := public.get_club('deccan-dawn');
  IF v_club_json->>'my_role' IS NOT NULL OR jsonb_array_length(v_club_json->'members') <> 0 THEN RAISE EXCEPTION 'outsider sees roster'; END IF;
  IF EXISTS (SELECT 1 FROM public.club_members) THEN RAISE EXCEPTION 'outsider reads club_members'; END IF;
  IF jsonb_array_length(v_club_json->'rides') <> 2 THEN RAISE EXCEPTION 'outsider should see the public club rides'; END IF;

  -- Owner promotes, cannot leave as the only owner.
  PERFORM set_config('request.jwt.claim.sub', 'f1500000-0000-4000-8000-000000000001', true);
  PERFORM public.set_club_member_role(v_club, 'f1500000-0000-4000-8000-000000000002', 'admin');
  BEGIN
    PERFORM public.leave_club(v_club);
    RAISE EXCEPTION 'sole owner left';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF jsonb_array_length(public.get_my_clubs()) <> 1 THEN RAISE EXCEPTION 'my clubs missing'; END IF;
END $$;

-- Public page works signed out and names nobody.
RESET ROLE;
SET ROLE anon;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.get_public_club('deccan-dawn');
  IF v->>'name' <> 'Deccan Dawn Riders' OR (v->>'member_count')::int <> 2 THEN RAISE EXCEPTION 'public club wrong: %', v; END IF;
  IF v::text ILIKE '%Club Member%' OR v::text ILIKE '%join_code%' THEN RAISE EXCEPTION 'public club leaks members or code'; END IF;
  IF jsonb_array_length(v->'upcoming') < 1 THEN RAISE EXCEPTION 'public upcoming rides missing'; END IF;
  IF public.get_public_club('no-such-club') IS NOT NULL THEN RAISE EXCEPTION 'unknown club returned'; END IF;
END $$;
RESET ROLE;

-- Service role (here: the owner role) can verify.
UPDATE public.clubs SET verified = true WHERE slug = 'deccan-dawn';
DO $$ BEGIN
  IF NOT (SELECT verified FROM public.clubs WHERE slug = 'deccan-dawn') THEN RAISE EXCEPTION 'service could not verify'; END IF;
END $$;
