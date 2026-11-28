\set ON_ERROR_STOP on
-- Audit finding 10: deleting a ride, a voice message or an account queues the
-- matching Storage files for removal by the scheduled cleanup.
RESET ROLE;
-- Stand-in for Supabase's storage.objects (the local test database has none).
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.objects (bucket_id text, name text);
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f2400000-0000-4000-8000-000000000001', 'sc1@example.test', '{"username":"sc_captain","display_name":"SC Captain"}'),
  ('f2400000-0000-4000-8000-000000000002', 'sc2@example.test', '{"username":"sc_rider","display_name":"SC Rider"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f2400000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Cleanup ride","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  PERFORM set_config('test.sc_ride', v_ride::text, false);
END $$;
RESET ROLE;

DO $$
DECLARE
  v_ride text := current_setting('test.sc_ride');
  u1 text := 'f2400000-0000-4000-8000-000000000001';
  u2 text := 'f2400000-0000-4000-8000-000000000002';
  v_other text := gen_random_uuid()::text;
  v_ids bigint[]; v_done integer;
BEGIN
  DELETE FROM public.storage_cleanup_queue;
  INSERT INTO storage.objects VALUES
    ('ride-voice', v_ride || '/' || u1 || '/a.m4a'),
    ('journal_photos', v_ride || '/p1.jpg'),
    ('ride-voice', v_other || '/' || u2 || '/b.m4a'),
    ('ride-voice', v_other || '/' || gen_random_uuid() || '/keep.m4a'),
    ('avatars', u2 || '/me.png');

  PERFORM set_config('request.jwt.claim.sub', u1, true);
  PERFORM public.delete_trip(v_ride::uuid);
  IF (SELECT count(*) FROM public.storage_cleanup_queue WHERE reason = 'ride_deleted') <> 2 THEN
    RAISE EXCEPTION 'ride files not queued: %', (SELECT array_agg(object_name) FROM public.storage_cleanup_queue);
  END IF;

  PERFORM set_config('request.jwt.claim.sub', u2, true);
  PERFORM public.delete_user_account(u2::uuid);
  IF NOT EXISTS (SELECT 1 FROM public.storage_cleanup_queue WHERE bucket = 'avatars' AND object_name = u2 || '/me.png') THEN RAISE EXCEPTION 'avatar not queued'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storage_cleanup_queue WHERE object_name = v_other || '/' || u2 || '/b.m4a') THEN RAISE EXCEPTION 'voice clip of deleted rider not queued'; END IF;
  IF EXISTS (SELECT 1 FROM public.storage_cleanup_queue WHERE object_name LIKE '%keep.m4a') THEN RAISE EXCEPTION 'someone else''s clip queued'; END IF;

  SELECT array_agg(id) INTO v_ids FROM public.claim_storage_cleanup(10);
  IF array_length(v_ids, 1) <> 4 THEN RAISE EXCEPTION 'claim returned % rows', array_length(v_ids, 1); END IF;
  v_done := public.finish_storage_cleanup(v_ids);
  IF v_done <> 4 OR EXISTS (SELECT 1 FROM public.storage_cleanup_queue) THEN RAISE EXCEPTION 'queue not drained (% removed)', v_done; END IF;
END $$;

SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.claim_storage_cleanup(10);
    RAISE EXCEPTION 'rider could claim the cleanup queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DROP TABLE storage.objects;
