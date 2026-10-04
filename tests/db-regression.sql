\set ON_ERROR_STOP on
DO $$
DECLARE rpc regprocedure;
BEGIN
  FOREACH rpc IN ARRAY ARRAY[
    'public.is_ride_participant(uuid,uuid)'::regprocedure,
    'public.get_ride_members(uuid)'::regprocedure,
    'public.get_latest_ride_locations(uuid)'::regprocedure,
    'public.join_ride_by_code(text)'::regprocedure,
    'public.bulk_insert_location_updates(jsonb)'::regprocedure
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
