\set ON_ERROR_STOP on
-- A captain cannot attach a ride to someone else's club, or set a fee, with a
-- direct table write; the RPCs still work.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f2000000-0000-4000-8000-000000000001', 'cg1@example.test', '{"username":"cg_club_owner","display_name":"CG Owner"}'),
  ('f2000000-0000-4000-8000-000000000002', 'cg2@example.test', '{"username":"cg_outsider","display_name":"CG Outsider"}')
ON CONFLICT (id) DO NOTHING;
UPDATE public.app_flags SET enabled = true, rollout_percent = 100 WHERE key IN ('clubs', 'paid_registrations');
UPDATE public.app_flags SET enabled = false WHERE key = 'beta_free_pro';
SET ROLE authenticated;
DO $$
DECLARE v_club uuid; v_own_ride uuid; v_ride uuid;
  trip jsonb := '{"name":"Guard fixture","trip_type":"group","visibility":"public","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}';
  wps jsonb := '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000001', true);
  v_club := public.create_club('Guard Fixture Club', 'guard-fixture', NULL, NULL);
  v_own_ride := public.create_trip_plan(trip, wps, '[]'::jsonb, NULL);
  PERFORM public.set_ride_club(v_own_ride, v_club);
  IF (SELECT club_id FROM public.rides WHERE id = v_own_ride) IS DISTINCT FROM v_club THEN RAISE EXCEPTION 'set_ride_club stopped working'; END IF;
  PERFORM public.set_ride_registration(v_own_ride, 500, NULL, NULL);
  UPDATE public.rides SET name = 'Guard fixture renamed', club_id = club_id WHERE id = v_own_ride;

  PERFORM set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000002', true);
  v_ride := public.create_trip_plan(trip, wps, '[]'::jsonb, NULL);
  BEGIN
    UPDATE public.rides SET club_id = v_club WHERE id = v_ride;
    RAISE EXCEPTION 'outsider attached a ride to the club';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.rides SET registration_fee_paise = 100 WHERE id = v_ride;
    RAISE EXCEPTION 'fee set without set_ride_registration';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.rides (name, admin_id, club_id) VALUES ('Direct', 'f2000000-0000-4000-8000-000000000002', v_club);
    RAISE EXCEPTION 'ride inserted straight into the club';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.rides SET name = 'Outsider ride renamed', visibility = 'private' WHERE id = v_ride;
  IF (SELECT club_id FROM public.rides WHERE id = v_ride) IS NOT NULL THEN RAISE EXCEPTION 'club_id changed'; END IF;
END $$;
RESET ROLE;
