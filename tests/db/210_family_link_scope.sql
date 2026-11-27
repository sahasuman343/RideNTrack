\set ON_ERROR_STOP on
-- A family link shows its rider and the captain only, lasts the live ride, and ends 6 h after it.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f2100000-0000-4000-8000-000000000001', 'fs1@example.test', '{"username":"fs_captain","display_name":"FS Captain"}'),
  ('f2100000-0000-4000-8000-000000000002', 'fs2@example.test', '{"username":"fs_rider","display_name":"FS Rider"}'),
  ('f2100000-0000-4000-8000-000000000003', 'fs3@example.test', '{"username":"fs_other","display_name":"FS Other"}')
ON CONFLICT (id) DO NOTHING;
UPDATE public.app_flags SET enabled = true, rollout_percent = 100 WHERE key = 'free_safety_features';
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_code text; v_family text; v_snap jsonb; v_ids text[];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f2100000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Scope fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_ride;
  PERFORM set_config('test.fs_ride', v_ride::text, false);
  PERFORM set_config('request.jwt.claim.sub', 'f2100000-0000-4000-8000-000000000002', true);
  PERFORM public.join_ride_by_code(v_code);
  v_family := public.create_family_link(v_ride);
  PERFORM set_config('test.fs_token', v_family, false);
  PERFORM set_config('request.jwt.claim.sub', 'f2100000-0000-4000-8000-000000000003', true);
  PERFORM public.join_ride_by_code(v_code);
  PERFORM set_config('request.jwt.claim.sub', 'f2100000-0000-4000-8000-000000000001', true);
  PERFORM public.start_ride(v_ride, 'fixture');
END $$;
RESET ROLE;
INSERT INTO public.location_updates (ride_id, user_id, lat, lng, timestamp)
SELECT current_setting('test.fs_ride')::uuid, u, 12.1, 77.1, now()
  FROM unnest(ARRAY['f2100000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000002', 'f2100000-0000-4000-8000-000000000003']::uuid[]) u;
SET ROLE anon;
DO $$
DECLARE v_snap jsonb; v_ids text[];
BEGIN
  v_snap := public.get_public_ride_snapshot(current_setting('test.fs_token'));
  SELECT array_agg(p->>'user_id' ORDER BY p->>'user_id') INTO v_ids FROM jsonb_array_elements(v_snap->'participants') p;
  IF v_ids IS DISTINCT FROM ARRAY['f2100000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000002'] THEN
    RAISE EXCEPTION 'family link shows % instead of the rider and the captain', v_ids;
  END IF;
END $$;
-- A long live ride: the link still works after its 72 hours.
RESET ROLE;
UPDATE public.rides SET started_at = now() - interval '80 hours' WHERE id = current_setting('test.fs_ride')::uuid;
UPDATE public.ride_share_links SET expires_at = now() - interval '1 hour' WHERE token = current_setting('test.fs_token');
SET ROLE anon;
DO $$ BEGIN
  IF public.get_public_ride_snapshot(current_setting('test.fs_token')) IS NULL THEN RAISE EXCEPTION 'family link died mid-ride'; END IF;
END $$;
-- The ride ends after the link's 72 hours ran out: it still lasts 6 more hours.
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f2100000-0000-4000-8000-000000000001', true);
  PERFORM public.end_ride(current_setting('test.fs_ride')::uuid);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT expires_at FROM public.ride_share_links WHERE token = current_setting('test.fs_token'))
     NOT BETWEEN now() + interval '5 hours 59 minutes' AND now() + interval '6 hours 1 minute' THEN
    RAISE EXCEPTION 'family link not set to ride end + 6 h';
  END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
  IF public.get_public_ride_snapshot(current_setting('test.fs_token')) IS NULL THEN RAISE EXCEPTION 'family link died at ride end'; END IF;
END $$;
RESET ROLE;
UPDATE public.rides SET ended_at = now() - interval '7 hours' WHERE id = current_setting('test.fs_ride')::uuid;
UPDATE public.ride_share_links SET expires_at = now() - interval '1 hour' WHERE token = current_setting('test.fs_token');
SET ROLE anon;
DO $$ BEGIN
  IF public.get_public_ride_snapshot(current_setting('test.fs_token')) IS NOT NULL THEN RAISE EXCEPTION 'family link works after the ride'; END IF;
END $$;
RESET ROLE;
-- The ride is restarted later: the ended link stays dead, a new link works.
UPDATE public.rides SET status = 'active', started_at = now(), ended_at = NULL WHERE id = current_setting('test.fs_ride')::uuid;
SET ROLE anon;
DO $$ BEGIN
  IF public.get_public_ride_snapshot(current_setting('test.fs_token')) IS NOT NULL THEN RAISE EXCEPTION 'restart revived an ended family link'; END IF;
END $$;
SET ROLE authenticated;
DO $$ DECLARE v_new text; BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f2100000-0000-4000-8000-000000000002', true);
  v_new := public.create_family_link(current_setting('test.fs_ride')::uuid);
  IF v_new = current_setting('test.fs_token') THEN RAISE EXCEPTION 'reused the ended link'; END IF;
  PERFORM set_config('test.fs_token2', v_new, false);
END $$;
SET ROLE anon;
DO $$ BEGIN
  IF public.get_public_ride_snapshot(current_setting('test.fs_token2')) IS NULL THEN RAISE EXCEPTION 'new family link does not work'; END IF;
END $$;
RESET ROLE;
