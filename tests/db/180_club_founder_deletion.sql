\set ON_ERROR_STOP on
-- A rider who started a club (and a regular ride) can still delete their account.
-- The club stays for its other members; join_club follows the clubs flag.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1800000-0000-4000-8000-000000000001', 'founder@example.test', '{"username":"club_founder","display_name":"Club Founder"}'),
  ('f1800000-0000-4000-8000-000000000002', 'stayer@example.test', '{"username":"club_stayer","display_name":"Club Stayer"}')
ON CONFLICT (id) DO NOTHING;

SET ROLE authenticated;
DO $$
DECLARE v_club uuid; v_ride uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1800000-0000-4000-8000-000000000001', true);
  v_club := public.create_club('Founder Riders', 'founder-riders', 'Pune', NULL, 'open');
  v_ride := public.create_trip_plan(
    '{"name":"Founder template","trip_type":"group","visibility":"private","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb, '[]'::jsonb, NULL);
  PERFORM public.set_ride_club(v_ride, v_club);
  PERFORM public.create_club_series(v_club, 'Sunday run', 'FREQ=WEEKLY;BYDAY=SU', v_ride);

  PERFORM set_config('request.jwt.claim.sub', 'f1800000-0000-4000-8000-000000000002', true);
  PERFORM public.join_club('founder-riders', NULL);

  PERFORM set_config('request.jwt.claim.sub', 'f1800000-0000-4000-8000-000000000001', true);
  PERFORM public.delete_user_account('f1800000-0000-4000-8000-000000000001');
END $$;
RESET ROLE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = 'f1800000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'founder account not deleted'; END IF;
  IF (SELECT created_by FROM public.clubs WHERE slug = 'founder-riders') IS NOT NULL THEN RAISE EXCEPTION 'club still points at the deleted founder'; END IF;
  IF (SELECT count(*) FROM public.club_ride_series s JOIN public.clubs c ON c.id = s.club_id WHERE c.slug = 'founder-riders' AND s.created_by IS NULL) <> 1 THEN RAISE EXCEPTION 'series lost or still points at the founder'; END IF;
  IF (SELECT count(*) FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id WHERE c.slug = 'founder-riders') <> 1 THEN RAISE EXCEPTION 'remaining member lost'; END IF;
  -- Finding 8: the remaining member becomes the owner (migration 067).
  IF (SELECT m.role FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
       WHERE c.slug = 'founder-riders' AND m.user_id = 'f1800000-0000-4000-8000-000000000002') <> 'owner' THEN
    RAISE EXCEPTION 'no new owner after the founder left';
  END IF;
END $$;

-- join_club respects the clubs flag.
UPDATE public.app_flags SET enabled = false WHERE key = 'clubs';
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1800000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.join_club('deccan-dawn', NULL);
    RAISE EXCEPTION 'joined a club with clubs off';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.app_flags SET enabled = true WHERE key = 'clubs';
