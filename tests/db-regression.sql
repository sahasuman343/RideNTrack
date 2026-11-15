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
    'public.create_trip_plan(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.save_trip_itinerary(uuid,jsonb)'::regprocedure,
    'public.add_trip_stay(uuid,jsonb)'::regprocedure,
    'public.create_trip_invitation(uuid,text,text,integer)'::regprocedure,
    'public.accept_trip_invitation(uuid)'::regprocedure,
    'public.set_trip_participant_role(uuid,uuid,text)'::regprocedure,
    'public.get_trip_roster(uuid)'::regprocedure,
    'public.update_group_safety_settings(uuid,integer,integer)'::regprocedure,
    'public.add_regroup_point(uuid,text,double precision,double precision,integer,timestamp with time zone,text)'::regprocedure,
    'public.confirm_regroup_arrival(uuid)'::regprocedure,
    'public.get_regroup_points(uuid)'::regprocedure
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
DO $$
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

  -- Add a second stay and verify multiple stays can belong to one trip day.
  PERFORM public.add_trip_stay(created_id,
    '{"name":"Second stay","stay_type":"homestay","price_amount":800,"day_number":2}'::jsonb);
  IF (SELECT count(*) FROM public.trip_stays WHERE ride_id = created_id) <> 2 THEN
    RAISE EXCEPTION 'multiple stays were not persisted';
  END IF;

  -- Reorder all waypoints and move the first waypoint to day two.
  PERFORM public.save_trip_itinerary(created_id, (
    SELECT jsonb_agg(jsonb_build_object(
      'id', w.id,
      'sequence', CASE WHEN w.sequence = 0 THEN 1 ELSE 0 END,
      'day_number', CASE WHEN w.sequence = 0 THEN 2 ELSE 1 END
    ) ORDER BY w.sequence DESC)
    FROM public.trip_waypoints w WHERE w.ride_id = created_id
  ));
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_waypoints w JOIN public.trip_days d ON d.id = w.trip_day_id
    WHERE w.ride_id = created_id AND w.name = 'B' AND w.sequence = 0 AND d.day_number = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.trip_waypoints w JOIN public.trip_days d ON d.id = w.trip_day_id
    WHERE w.ride_id = created_id AND w.name = 'A' AND w.sequence = 1 AND d.day_number = 2
  ) THEN
    RAISE EXCEPTION 'itinerary reorder or day reassignment failed';
  END IF;

  BEGIN
    PERFORM public.add_trip_stay(created_id,
      '{"name":"Invalid price","price_amount":-1,"day_number":1}'::jsonb);
    RAISE EXCEPTION 'negative stay price unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'negative stay price unexpectedly accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_trip_plan(
      '{"name":"Invalid dates","trip_type":"touring","start_date":"2026-11-22","end_date":"2026-11-20","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
      '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
      '[]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'invalid trip date range unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'invalid trip date range unexpectedly accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_trip_plan(
      '{"name":"Invalid stay price","trip_type":"touring","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
      '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
      '[]'::jsonb,
      '{"name":"Bad stay","price_amount":-10}'::jsonb
    );
    RAISE EXCEPTION 'negative initial stay price unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'negative initial stay price unexpectedly accepted' THEN RAISE; END IF;
  END;

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
END $$;

-- Phase 2: invite acceptance, role assignment, roster visibility and expiry.
DO $$
DECLARE v_trip UUID; v_token UUID; v_expired_token UUID; v_joined UUID;
BEGIN
  SELECT id INTO v_trip FROM public.rides WHERE name='Atomic trip fixture';
  SELECT invitation_token INTO v_token
    FROM public.create_trip_invitation(v_trip,'member@example.test','sweep',24);
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  v_joined := public.accept_trip_invitation(v_token);
  IF v_joined IS DISTINCT FROM v_trip THEN RAISE EXCEPTION 'invitation did not join expected trip'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id=v_trip
    AND user_id=auth.uid() AND role='sweep' AND is_active) THEN
    RAISE EXCEPTION 'invited sweep role was not applied';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  PERFORM public.set_trip_participant_role(v_trip,'22222222-2222-4222-8222-222222222222','rider');
  IF NOT EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id=v_trip
    AND user_id='22222222-2222-4222-8222-222222222222' AND role='rider') THEN
    RAISE EXCEPTION 'leader could not update rider role';
  END IF;
  IF (SELECT count(*) FROM public.get_trip_roster(v_trip)) <> 2 THEN
    RAISE EXCEPTION 'trip roster missing active members';
  END IF;
  PERFORM public.update_group_safety_settings(v_trip,750,1500);
  PERFORM public.add_regroup_point(v_trip,'Lake regroup',12.9716,77.5946,0,NULL,'Wait for the group');
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  IF public.confirm_regroup_arrival((SELECT id FROM public.trip_regroup_points WHERE ride_id=v_trip AND name='Lake regroup')) IS NULL THEN
    RAISE EXCEPTION 'regroup arrival was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_regroup_points(v_trip) WHERE name='Lake regroup' AND arrived_count=1 AND my_arrived) THEN
    RAISE EXCEPTION 'regroup arrival status missing';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  SELECT invitation_token INTO v_expired_token
    FROM public.create_trip_invitation(v_trip,NULL,'rider',0);
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  IF public.accept_trip_invitation(v_expired_token) IS NOT NULL THEN
    RAISE EXCEPTION 'expired invitation was accepted';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  IF NOT EXISTS (SELECT 1 FROM public.trip_invitations WHERE token=v_expired_token AND status='expired') THEN
    RAISE EXCEPTION 'expired invitation state was not persisted';
  END IF;
END $$;

SET request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ DECLARE trip_id uuid; BEGIN
  SELECT id INTO trip_id FROM public.rides WHERE name = 'Atomic trip fixture';
  IF (SELECT count(*) FROM public.get_ride_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) != 0 THEN RAISE EXCEPTION 'outsider sees members'; END IF;
  IF (SELECT count(*) FROM realtime.messages) != 0 THEN RAISE EXCEPTION 'outsider receives private presence'; END IF;
  BEGIN
    PERFORM public.save_trip_itinerary(trip_id, '[]'::jsonb);
    RAISE EXCEPTION 'non-admin itinerary edit allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.add_trip_stay(trip_id, '{"name":"Unauthorized stay"}'::jsonb);
    RAISE EXCEPTION 'non-admin accommodation edit allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
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
