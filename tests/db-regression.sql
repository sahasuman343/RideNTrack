\set ON_ERROR_STOP on
DO $$
DECLARE rpc regprocedure;
BEGIN
  FOREACH rpc IN ARRAY ARRAY[
    'public.is_ride_participant(uuid,uuid)'::regprocedure,
    'public.get_ride_members(uuid)'::regprocedure,
    'public.get_latest_ride_locations(uuid)'::regprocedure,
    'public.join_ride_by_code(text)'::regprocedure,
    'public.bulk_insert_location_updates(jsonb)'::regprocedure,
    'public.create_trip_plan(jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon',rpc,'EXECUTE') THEN
      RAISE EXCEPTION 'anonymous RPC access: %',rpc;
    END IF;
    IF NOT has_function_privilege('authenticated',rpc,'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated RPC access missing: %',rpc;
    END IF;
  END LOOP;
  FOREACH rpc IN ARRAY ARRAY[
    'public.auto_join_admin()'::regprocedure,
    'public.handle_new_user()'::regprocedure
  ] LOOP
    IF has_function_privilege('anon',rpc,'EXECUTE')
       OR has_function_privilege('authenticated',rpc,'EXECUTE') THEN
      RAISE EXCEPTION 'trigger function exposed to clients: %',rpc;
    END IF;
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,anon;
GRANT SELECT,INSERT ON realtime.messages TO authenticated;
INSERT INTO auth.users VALUES
 ('11111111-1111-4111-8111-111111111111','owner@example.test','{"username":"owner","display_name":"Owner"}'),
 ('22222222-2222-4222-8222-222222222222','member@example.test','{"username":"member","display_name":"Member"}'),
 ('33333333-3333-4333-8333-333333333333','outsider@example.test','{"username":"outsider","display_name":"Outsider"}');
SET ROLE anon;
DO $$ BEGIN
  IF public.is_username_available('owner') OR public.is_username_available(' owner ') THEN RAISE EXCEPTION 'taken username accepted'; END IF;
  IF NOT public.is_username_available('unused-signup-name') THEN RAISE EXCEPTION 'available username rejected'; END IF;
  IF public.is_username_available(NULL) OR public.is_username_available('   ') OR public.is_username_available(repeat('x',65)) THEN RAISE EXCEPTION 'invalid username accepted'; END IF;
  IF (SELECT count(*) FROM public.profiles) != 0 THEN RAISE EXCEPTION 'signup preflight exposes profiles'; END IF;
END $$;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.rides (id,name,ride_code,admin_id,origin,destination,origin_coords,destination_coords)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test','ABCDEF',auth.uid(),'A','B','[77,12]','[78,13]');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles) != 1 THEN RAISE EXCEPTION 'private profiles exposed'; END IF;
  IF (SELECT count(*) FROM public.ride_participants) != 1 THEN RAISE EXCEPTION 'admin not joined'; END IF;
END $$;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
SELECT public.join_ride_by_code(' abcdef ');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.get_ride_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) != 2 THEN RAISE EXCEPTION 'member names unavailable'; END IF;
END $$;
SELECT public.bulk_insert_location_updates('[{"client_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","ride_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","user_id":"22222222-2222-4222-8222-222222222222","lat":0,"lng":0,"timestamp":"2026-10-01T00:00:00Z"}]');
SELECT public.bulk_insert_location_updates('[{"client_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","ride_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","user_id":"22222222-2222-4222-8222-222222222222","lat":0,"lng":0,"timestamp":"2026-10-01T00:00:00Z"}]');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.location_updates) != 1 THEN RAISE EXCEPTION 'retry duplicated GPS'; END IF;
  IF (SELECT count(*) FROM public.get_latest_ride_locations('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) != 1 THEN RAISE EXCEPTION 'last-known location missing'; END IF;
END $$;
INSERT INTO public.alerts (id,ride_id,user_id,type,lat,lng) VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),'fuel',0,0) ON CONFLICT DO NOTHING;
INSERT INTO public.alerts (id,ride_id,user_id,type,lat,lng) VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),'fuel',0,0) ON CONFLICT DO NOTHING;
SET realtime.topic = 'ride:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO realtime.messages VALUES (1,'presence');

-- Atomic trip aggregate creation: parent and child records commit together.
DO $
DECLARE created_id uuid;
BEGIN
  created_id := public.create_trip_plan(
    '{"name":"Atomic trip fixture","trip_type":"touring","visibility":"invite_only","start_date":"2026-11-20","end_date":"2026-11-21","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77,"day_number":1},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78,"day_number":2}]'::jsonb,
    '[{"day_number":1,"trip_date":"2026-11-20","title":"Day 1"},{"day_number":2,"trip_date":"2026-11-21","title":"Day 2"}]'::jsonb,
    '{"name":"First stay","stay_type":"hotel","price_amount":1200,"day_number":1}'::jsonb
  );
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = created_id AND admin_id = auth.uid()) THEN
    RAISE EXCEPTION 'trip parent was not created for authenticated admin';
  END IF;
  IF (SELECT count(*) FROM public.trip_days WHERE ride_id = created_id) <> 2 THEN
    RAISE EXCEPTION 'trip days missing';
  END IF;
  IF (SELECT count(*) FROM public.trip_waypoints WHERE ride_id = created_id) <> 2 THEN
    RAISE EXCEPTION 'trip waypoints missing';
  END IF;
  IF (SELECT count(*) FROM public.trip_waypoints w JOIN public.trip_days d ON d.id = w.trip_day_id
      WHERE w.ride_id = created_id AND d.day_number = w.sequence + 1) <> 2 THEN
    RAISE EXCEPTION 'waypoint day assignment missing';
  END IF;
  IF (SELECT count(*) FROM public.trip_stays WHERE ride_id = created_id) <> 1 THEN
    RAISE EXCEPTION 'initial stay missing';
  END IF;

  BEGIN
    PERFORM public.create_trip_plan(
      '{"name":"Must rollback","trip_type":"group","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
      '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":999,"longitude":78}]'::jsonb,
      '[]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'invalid waypoint unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.rides WHERE name = 'Must rollback') THEN
    RAISE EXCEPTION 'failed child insert left a partial trip';
  END IF;
END $;

SET request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.get_ride_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) != 0 THEN RAISE EXCEPTION 'outsider sees members'; END IF;
  IF (SELECT count(*) FROM realtime.messages) != 0 THEN RAISE EXCEPTION 'outsider receives private presence'; END IF;
  BEGIN
    INSERT INTO public.ride_participants (ride_id,user_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid());
    RAISE EXCEPTION 'direct join allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.alerts (ride_id,user_id,type,lat,lng) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),'emergency',0,0);
    RAISE EXCEPTION 'outsider alert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO realtime.messages VALUES (2,'presence');
    RAISE EXCEPTION 'outsider presence allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
