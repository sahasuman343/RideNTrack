\set ON_ERROR_STOP on
-- Audit finding 7: club_role / is_club_admin only answer about the caller or
-- about people in the caller's own club. Service-role calls (no JWT) still see
-- everything, and paid registration sees members of a private ride.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f2300000-0000-4000-8000-000000000001', 'chp1@example.test', '{"username":"chp_owner","display_name":"CHP Owner"}'),
  ('f2300000-0000-4000-8000-000000000002', 'chp2@example.test', '{"username":"chp_member","display_name":"CHP Member"}'),
  ('f2300000-0000-4000-8000-000000000003', 'chp3@example.test', '{"username":"chp_outsider","display_name":"CHP Outsider"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_club uuid; v_ride uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f2300000-0000-4000-8000-000000000001', true);
  v_club := public.create_club('Helper Privacy Riders', 'helper-privacy', NULL, NULL, 'open');
  v_ride := public.create_trip_plan(
    '{"name":"Private paid ride","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13],"start_date":"2099-02-01"}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  PERFORM set_config('test.chp_club', v_club::text, false);
  PERFORM set_config('test.chp_ride', v_ride::text, false);

  PERFORM set_config('request.jwt.claim.sub', 'f2300000-0000-4000-8000-000000000003', true);
  IF public.club_role(v_club, 'f2300000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'outsider read the owner''s role'; END IF;
  IF public.is_club_admin(v_club, 'f2300000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'outsider learned who admins the club'; END IF;
  IF public.club_role(v_club, auth.uid()) IS NOT NULL THEN RAISE EXCEPTION 'outsider has a role'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'f2300000-0000-4000-8000-000000000002', true);
  PERFORM public.join_club('helper-privacy', NULL);
  IF public.club_role(v_club, auth.uid()) IS DISTINCT FROM 'member' THEN RAISE EXCEPTION 'member cannot read own role'; END IF;
  IF public.club_role(v_club, 'f2300000-0000-4000-8000-000000000001') IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'member cannot see the roster role'; END IF;
END $$;
RESET ROLE;

-- No JWT (service role): sees every role, and a private ride's member can register.
DO $$
DECLARE v_club uuid := current_setting('test.chp_club')::uuid; v_ride uuid := current_setting('test.chp_ride')::uuid; v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.club_role(v_club, 'f2300000-0000-4000-8000-000000000001') IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'service role lost club_role'; END IF;
  INSERT INTO public.ride_participants (ride_id, user_id, role, is_active)
  VALUES (v_ride, 'f2300000-0000-4000-8000-000000000003', 'rider', true)
  ON CONFLICT DO NOTHING;
  UPDATE public.rides SET registration_fee_paise = 50000 WHERE id = v_ride;
  v := public.begin_ride_registration(v_ride, 'f2300000-0000-4000-8000-000000000003');
  IF v->>'status' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'private ride member could not register: %', v; END IF;
  DELETE FROM public.ride_registrations WHERE ride_id = v_ride;
  DELETE FROM public.rides WHERE id = v_ride;
  DELETE FROM public.clubs WHERE id = v_club;
END $$;
