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
    'public.save_trip_route(uuid,jsonb,jsonb)'::regprocedure,
    'public.delete_trip(uuid)'::regprocedure,
    'public.leave_ride(uuid)'::regprocedure,
    'public.save_trip_stage(uuid,jsonb)'::regprocedure,
    'public.delete_trip_stage(uuid,uuid)'::regprocedure,
    'public.update_stage_status(uuid,text)'::regprocedure,
    'public.get_trip_stages(uuid)'::regprocedure,
    'public.add_trip_stay(uuid,jsonb)'::regprocedure,
    'public.create_trip_invitation(uuid,text,text,integer)'::regprocedure,
    'public.accept_trip_invitation(uuid)'::regprocedure,
    'public.set_trip_participant_role(uuid,uuid,text)'::regprocedure,
    'public.get_trip_roster(uuid)'::regprocedure,
    'public.update_group_safety_settings(uuid,integer,integer)'::regprocedure,
    'public.add_regroup_point(uuid,text,double precision,double precision,integer,timestamp with time zone,text)'::regprocedure,
    'public.confirm_regroup_arrival(uuid)'::regprocedure,
    'public.get_regroup_points(uuid)'::regprocedure,
    'public.save_trip_journal_entry(uuid,text,text,text,integer,jsonb)'::regprocedure,
    'public.get_rider_analytics(uuid)'::regprocedure,
    'public.delete_user_account()'::regprocedure,
    'public.archive_trip(uuid)'::regprocedure,
    'public.unarchive_trip(uuid)'::regprocedure,
    'public.duplicate_trip(uuid,text,date)'::regprocedure,
    'public.seed_default_trip_checklists(uuid)'::regprocedure,
    'public.get_trip_checklists(uuid)'::regprocedure,
    'public.toggle_trip_checklist_item(uuid,boolean)'::regprocedure,
    'public.transfer_trip_leadership(uuid,uuid)'::regprocedure,
    'public.remove_trip_participant(uuid,uuid)'::regprocedure,
    'public.reject_trip_invitation(uuid)'::regprocedure
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
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
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

  -- Full route replacement keeps existing waypoint IDs and day links while adding a new stop.
  PERFORM public.save_trip_route(created_id,
    '{"origin":"B revised","destination":"A revised","origin_coords":[78,13],"destination_coords":[77,12],"route_geometry":{"type":"Feature","geometry":{"type":"LineString","coordinates":[[78,13],[77.5,12.5],[77,12]]},"properties":{}},"estimated_distance_meters":125000,"estimated_duration_seconds":7200}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('id',(SELECT id FROM public.trip_waypoints WHERE ride_id=created_id AND name='B'),'sequence',0,'waypoint_type','origin','name','B revised','address','B revised','latitude',13,'longitude',78,'day_number',1),
      jsonb_build_object('id',NULL,'sequence',1,'waypoint_type','fuel','name','Fuel stop','address','Fuel stop','latitude',12.5,'longitude',77.5,'day_number',1),
      jsonb_build_object('id',(SELECT id FROM public.trip_waypoints WHERE ride_id=created_id AND name='A'),'sequence',2,'waypoint_type','destination','name','A revised','address','A revised','latitude',12,'longitude',77,'day_number',2)
    )
  );
  IF (SELECT count(*) FROM public.trip_waypoints WHERE ride_id=created_id) <> 3
     OR NOT EXISTS (SELECT 1 FROM public.trip_waypoints WHERE ride_id=created_id AND name='B revised' AND sequence=0)
     OR NOT EXISTS (SELECT 1 FROM public.trip_waypoints WHERE ride_id=created_id AND name='Fuel stop' AND sequence=1)
     OR NOT EXISTS (SELECT 1 FROM public.trip_waypoints WHERE ride_id=created_id AND name='A revised' AND sequence=2)
     OR NOT EXISTS (SELECT 1 FROM public.rides WHERE id=created_id AND origin='B revised' AND destination='A revised'
       AND estimated_distance_meters=125000 AND estimated_duration_seconds=7200
       AND route_geometry->'geometry'->>'type'='LineString') THEN
    RAISE EXCEPTION 'full route edit did not update route and waypoint aggregate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trip_waypoints w JOIN public.trip_days d ON d.id=w.trip_day_id
      WHERE w.ride_id=created_id AND w.name='A revised' AND d.day_number=2) THEN
    RAISE EXCEPTION 'full route edit did not preserve waypoint day assignment';
  END IF;

  BEGIN
    PERFORM public.save_trip_route(created_id,
      '{"origin":"Should not persist","destination":"A","origin_coords":[78,13],"destination_coords":[77,12],"route_geometry":null}'::jsonb,
      '[{"sequence":0,"waypoint_type":"origin","name":"Bad","latitude":999,"longitude":78},{"sequence":1,"waypoint_type":"destination","name":"A","latitude":12,"longitude":77}]'::jsonb
    );
    RAISE EXCEPTION 'invalid route coordinates unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'invalid route coordinates unexpectedly accepted' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id=created_id AND origin='B revised')
     OR (SELECT count(*) FROM public.trip_waypoints WHERE ride_id=created_id) <> 3 THEN
    RAISE EXCEPTION 'failed route edit left partial changes';
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
    PERFORM public.save_trip_route(trip_id,'{}'::jsonb,'[]'::jsonb);
    RAISE EXCEPTION 'non-admin route edit allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.delete_trip(trip_id);
    RAISE EXCEPTION 'non-admin trip deletion allowed';
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

-- Direct writes must preserve ride/day ownership, including updates.
DO $$
DECLARE
  ride_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  ride_b uuid;
  day_a uuid;
  day_b uuid;
  stay_id uuid;
  waypoint_id uuid;
BEGIN
  SELECT id INTO STRICT ride_b FROM public.rides WHERE name = 'Atomic trip fixture';
  INSERT INTO public.trip_days (ride_id, day_number) VALUES (ride_a, 99) RETURNING id INTO day_a;
  INSERT INTO public.trip_days (ride_id, day_number) VALUES (ride_b, 99) RETURNING id INTO day_b;
  INSERT INTO public.trip_stays (ride_id, name) VALUES (ride_a, 'Unassigned constraint fixture') RETURNING id INTO stay_id;
  INSERT INTO public.trip_waypoints (ride_id, sequence, waypoint_type, name, latitude, longitude)
    VALUES (ride_a, 99, 'stop', 'Unassigned constraint fixture', 0, 0) RETURNING id INTO waypoint_id;
  BEGIN
    INSERT INTO public.trip_stays (ride_id, trip_day_id, name) VALUES (ride_a, day_b, 'Invalid');
    RAISE EXCEPTION 'cross-ride stay insert accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.trip_waypoints (ride_id, trip_day_id, sequence, waypoint_type, name, latitude, longitude)
      VALUES (ride_a, day_b, 100, 'stop', 'Invalid', 0, 0);
    RAISE EXCEPTION 'cross-ride waypoint insert accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE public.trip_stays SET trip_day_id = day_b WHERE id = stay_id;
    RAISE EXCEPTION 'cross-ride stay update accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE public.trip_waypoints SET trip_day_id = day_b WHERE id = waypoint_id;
    RAISE EXCEPTION 'cross-ride waypoint update accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  UPDATE public.trip_stays SET trip_day_id = day_a WHERE id = stay_id;
  UPDATE public.trip_waypoints SET trip_day_id = day_a WHERE id = waypoint_id;
  DELETE FROM public.trip_days WHERE id = day_a;
  IF NOT EXISTS (SELECT 1 FROM public.trip_stays WHERE id = stay_id AND ride_id = ride_a AND trip_day_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.trip_waypoints WHERE id = waypoint_id AND ride_id = ride_a AND trip_day_id IS NULL) THEN
    RAISE EXCEPTION 'day deletion must preserve unassigned stays and waypoints';
  END IF;
END $$;


-- Trip deletion is leader-only and cascades the complete trip aggregate.
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$
DECLARE
  deleted_id UUID;
BEGIN
  deleted_id := public.create_trip_plan(
    '{"name":"Delete trip fixture","trip_type":"touring","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[{"day_number":1,"title":"Day 1"}]'::jsonb,
    '{"name":"Delete fixture stay","stay_type":"hotel","day_number":1}'::jsonb
  );
  PERFORM public.add_regroup_point(deleted_id,'Delete fixture regroup',12,77,0,NULL,NULL);
  PERFORM public.create_trip_invitation(deleted_id,NULL,'rider',72);
  PERFORM public.delete_trip(deleted_id);
  IF EXISTS (SELECT 1 FROM public.rides WHERE id=deleted_id)
     OR EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id=deleted_id)
     OR EXISTS (SELECT 1 FROM public.trip_days WHERE ride_id=deleted_id)
     OR EXISTS (SELECT 1 FROM public.trip_waypoints WHERE ride_id=deleted_id)
     OR EXISTS (SELECT 1 FROM public.trip_stays WHERE ride_id=deleted_id)
     OR EXISTS (SELECT 1 FROM public.trip_invitations WHERE ride_id=deleted_id)
     OR EXISTS (SELECT 1 FROM public.trip_regroup_points WHERE ride_id=deleted_id) THEN
    RAISE EXCEPTION 'trip deletion did not cascade to its dependent records';
  END IF;
END $$;

DO $$
DECLARE
  test_ride_id UUID;
  member_id UUID := '22222222-2222-4222-8222-222222222222';
  owner_id UUID := '11111111-1111-4111-8111-111111111111';
  v_code TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  test_ride_id := public.create_trip_plan(
    '{"name":"Leave ride fixture","trip_type":"touring","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[{"day_number":1,"title":"Day 1"}]'::jsonb,
    NULL
  );
  SELECT ride_code INTO v_code FROM public.rides WHERE id = test_ride_id;
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.join_ride_by_code(v_code);

  -- Owner cannot leave own ride
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  BEGIN
    PERFORM public.leave_ride(test_ride_id);
    RAISE EXCEPTION 'owner should not be permitted to leave own ride';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Member can leave ride
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.leave_ride(test_ride_id);
  IF NOT EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id=test_ride_id AND user_id=member_id AND is_active=false) THEN
    RAISE EXCEPTION 'member leaving ride was not set to inactive';
  END IF;

  -- Cleanup
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.delete_trip(test_ride_id);
END $$;

DO $$
DECLARE
  stage_trip_id UUID;
  stage_1_id UUID;
  stage_2_id UUID;
  owner_id UUID := '11111111-1111-4111-8111-111111111111';
  member_id UUID := '22222222-2222-4222-8222-222222222222';
  v_stage_code TEXT;
  stage_count INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  stage_trip_id := public.create_trip_plan(
    '{"name":"Stage test fixture","trip_type":"touring","visibility":"invite_only","origin":"Bengaluru","destination":"Gokarna","origin_coords":[77.59,12.97],"destination_coords":[74.31,14.54]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Bengaluru","latitude":12.97,"longitude":77.59},{"sequence":1,"waypoint_type":"destination","name":"Gokarna","latitude":14.54,"longitude":74.31}]'::jsonb,
    '[{"day_number":1,"title":"Day 1: Ghats"},{"day_number":2,"title":"Day 2: Coast"}]'::jsonb,
    NULL
  );
  SELECT ride_code INTO v_stage_code FROM public.rides WHERE id = stage_trip_id;
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.join_ride_by_code(v_stage_code);
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  -- 1. Owner can create riding stages
  stage_1_id := public.save_trip_stage(stage_trip_id, '{
    "name": "Stage 1: Bengaluru to Hassan",
    "start_name": "Bengaluru",
    "destination_name": "Hassan",
    "start_coords": [77.59, 12.97],
    "destination_coords": [76.10, 13.00],
    "day_number": 1,
    "notes": "Smooth expressway leg"
  }'::jsonb);

  stage_2_id := public.save_trip_stage(stage_trip_id, '{
    "name": "Stage 2: Hassan to Mangaluru",
    "start_name": "Hassan",
    "destination_name": "Mangaluru",
    "start_coords": [76.10, 13.00],
    "destination_coords": [74.85, 12.91],
    "day_number": 1,
    "notes": "Shiradi ghat section"
  }'::jsonb);

  IF stage_1_id IS NULL OR stage_2_id IS NULL THEN
    RAISE EXCEPTION 'failed to create trip stages';
  END IF;

  SELECT count(*) INTO stage_count FROM public.get_trip_stages(stage_trip_id);
  IF stage_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 stages, found %', stage_count;
  END IF;

  -- 2. Non-owner cannot create or delete stages
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  BEGIN
    PERFORM public.save_trip_stage(stage_trip_id, '{"name":"Hacked","start_name":"A","destination_name":"B","start_coords":[77,12],"destination_coords":[78,13]}'::jsonb);
    RAISE EXCEPTION 'member should not be permitted to create stage';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM public.delete_trip_stage(stage_trip_id, stage_1_id);
    RAISE EXCEPTION 'member should not be permitted to delete stage';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- 3. Participant CAN update stage status
  PERFORM public.update_stage_status(stage_1_id, 'in_progress');
  IF NOT EXISTS (SELECT 1 FROM public.trip_stages WHERE id=stage_1_id AND status='in_progress') THEN
    RAISE EXCEPTION 'failed to update stage status';
  END IF;

  -- 4. Owner can delete a stage and remaining stages renumber contiguously
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.delete_trip_stage(stage_trip_id, stage_1_id);

  SELECT stage_number INTO stage_count FROM public.trip_stages WHERE id=stage_2_id;
  IF stage_count <> 1 THEN
    RAISE EXCEPTION 'expected stage 2 to renumber to 1 after stage 1 deletion, got %', stage_count;
  END IF;

  -- 5. Cascade cleanup: deleting trip removes all associated stages
  PERFORM public.delete_trip(stage_trip_id);
  IF EXISTS (SELECT 1 FROM public.trip_stages WHERE ride_id=stage_trip_id) THEN
    RAISE EXCEPTION 'trip deletion did not cascade to trip_stages';
  END IF;
END $$;

DO $$
DECLARE
  journal_trip_id UUID;
  journal_id UUID;
  owner_id UUID := '11111111-1111-4111-8111-111111111111';
  outsider_id UUID := '33333333-3333-4333-8333-333333333333';
  analytics JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  journal_trip_id := public.create_trip_plan(
    '{"name":"Journal test fixture","trip_type":"touring","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[{"day_number":1,"title":"Day 1"}]'::jsonb,
    NULL
  );

  -- 1. Owner can save journal entry
  journal_id := public.save_trip_journal_entry(
    journal_trip_id,
    'Epic Coastal Ride',
    'Great weather, smooth roads',
    'Sunset at the cliff',
    5,
    '[{"id":"photo1","url":"https://example.com/p1.jpg","caption":"Sunset"}]'::jsonb
  );
  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'failed to save trip journal entry';
  END IF;

  -- 2. Outsider cannot save journal entry on private trip
  PERFORM set_config('request.jwt.claim.sub', outsider_id::text, true);
  BEGIN
    PERFORM public.save_trip_journal_entry(
      journal_trip_id,
      'Intruder entry',
      'Should fail',
      NULL,
      1,
      '[]'::jsonb
    );
    RAISE EXCEPTION 'outsider was permitted to save journal entry on private trip';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- 3. Analytics RPC works for authenticated user
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  analytics := public.get_rider_analytics(owner_id);
  IF analytics IS NULL OR NOT (analytics ? 'total_distance_km') OR NOT (analytics ? 'milestones') THEN
    RAISE EXCEPTION 'get_rider_analytics failed to return expected metrics';
  END IF;

  -- Cleanup
  PERFORM public.delete_trip(journal_trip_id);
END $$;

-- Phase 1 Milestone: Trip Archiving and Deep Duplication
DO $$
DECLARE
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  outsider_id uuid := '33333333-3333-4333-8333-333333333333';
  orig_trip_id uuid;
  cloned_trip_id uuid;
  cloned_stage_count integer;
  cloned_wp_count integer;
  trip_status text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  -- Create a trip with waypoints and stages
  orig_trip_id := public.create_trip_plan(
    '{"name":"Grand Western Ghats Tour","trip_type":"touring","visibility":"invite_only","start_date":"2026-12-01","end_date":"2026-12-05","origin":"Bengaluru","destination":"Goa","origin_coords":[77.5946,12.9716],"destination_coords":[73.8567,15.2993]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Bengaluru","latitude":12.9716,"longitude":77.5946,"day_number":1},{"sequence":1,"waypoint_type":"stop","name":"Shimoga","latitude":13.9299,"longitude":75.5681,"day_number":1},{"sequence":2,"waypoint_type":"destination","name":"Goa","latitude":15.2993,"longitude":73.8567,"day_number":2}]'::jsonb,
    '[{"day_number":1,"trip_date":"2026-12-01","title":"Day 1 - Ghats Climb"},{"day_number":2,"trip_date":"2026-12-02","title":"Day 2 - Coastal Descent"}]'::jsonb,
    '{"name":"Shimoga Lodge","stay_type":"hotel","price_amount":1500,"day_number":1}'::jsonb
  );

  -- Add a stage
  PERFORM public.save_trip_stage(orig_trip_id, '{
    "stage_number": 1,
    "name": "Stage 1",
    "start_name": "Bengaluru",
    "destination_name": "Shimoga",
    "start_coords": [77.5946, 12.9716],
    "destination_coords": [75.5681, 13.9299],
    "day_number": 1
  }'::jsonb);

  -- 1. Test Archiving
  PERFORM public.archive_trip(orig_trip_id);
  SELECT status INTO trip_status FROM public.rides WHERE id = orig_trip_id;
  IF trip_status != 'archived' THEN
    RAISE EXCEPTION 'archive_trip failed to set status to archived (got %)', trip_status;
  END IF;

  -- 2. Test Unarchiving
  PERFORM public.unarchive_trip(orig_trip_id);
  SELECT status INTO trip_status FROM public.rides WHERE id = orig_trip_id;
  IF trip_status != 'planned' THEN
    RAISE EXCEPTION 'unarchive_trip failed to set status to planned (got %)', trip_status;
  END IF;

  -- 3. Test Deep Duplication
  cloned_trip_id := public.duplicate_trip(orig_trip_id, 'Grand Western Ghats 2027', '2027-01-10');
  IF cloned_trip_id IS NULL OR cloned_trip_id = orig_trip_id THEN
    RAISE EXCEPTION 'duplicate_trip failed to return new distinct ride id';
  END IF;

  -- Verify cloned waypoints and stages
  SELECT count(*) INTO cloned_wp_count FROM public.trip_waypoints WHERE ride_id = cloned_trip_id;
  IF cloned_wp_count != 3 THEN
    RAISE EXCEPTION 'duplicate_trip expected 3 waypoints, found %', cloned_wp_count;
  END IF;

  SELECT count(*) INTO cloned_stage_count FROM public.trip_stages WHERE ride_id = cloned_trip_id;
  IF cloned_stage_count != 1 THEN
    RAISE EXCEPTION 'duplicate_trip expected 1 stage, found %', cloned_stage_count;
  END IF;

  -- 4. Outsider cannot archive private trip
  PERFORM set_config('request.jwt.claim.sub', outsider_id::text, true);
  BEGIN
    PERFORM public.archive_trip(orig_trip_id);
    RAISE EXCEPTION 'outsider was able to archive owner trip';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Cleanup
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.delete_trip(orig_trip_id);
  PERFORM public.delete_trip(cloned_trip_id);
END $$;

-- Phase 2 Milestone: 5-Tier Roles, Leadership Transfer, and Pre-Ride Checklist
DO $$
DECLARE
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  member_id uuid := '22222222-2222-4222-8222-222222222222';
  test_ride_id uuid;
  checklists jsonb;
  item_id uuid;
  first_item_completed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  -- 1. Create a trip
  test_ride_id := public.create_trip_plan(
    '{"name":"Roles and Checklist Test","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb,
    NULL
  );

  -- 2. Member joins ride
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.join_ride_by_code((SELECT ride_code FROM public.rides WHERE id = test_ride_id));

  -- 3. Owner assigns Marshal role
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.set_trip_participant_role(test_ride_id, member_id, 'marshal');
  IF (SELECT role FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = member_id) != 'marshal' THEN
    RAISE EXCEPTION 'set_trip_participant_role failed to set marshal role';
  END IF;

  -- 4. Seed and query pre-ride checklists
  PERFORM public.seed_default_trip_checklists(test_ride_id);
  checklists := public.get_trip_checklists(test_ride_id);
  IF jsonb_array_length(checklists) < 5 THEN
    RAISE EXCEPTION 'seed_default_trip_checklists expected at least 5 items, got %', jsonb_array_length(checklists);
  END IF;

  item_id := (checklists->0->>'id')::uuid;

  -- 5. Toggle checklist item
  first_item_completed := public.toggle_trip_checklist_item(item_id, true);
  IF first_item_completed != true THEN
    RAISE EXCEPTION 'toggle_trip_checklist_item failed to mark complete';
  END IF;

  -- 6. Transfer leadership
  PERFORM public.transfer_trip_leadership(test_ride_id, member_id);
  IF (SELECT admin_id FROM public.rides WHERE id = test_ride_id) != member_id THEN
    RAISE EXCEPTION 'transfer_trip_leadership failed to update admin_id';
  END IF;
  IF (SELECT role FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = member_id) != 'captain' THEN
    RAISE EXCEPTION 'new leader participant role is not captain';
  END IF;

  -- 7. New captain removes former leader
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.remove_trip_participant(test_ride_id, owner_id);
  IF (SELECT is_active FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = owner_id) != false THEN
    RAISE EXCEPTION 'remove_trip_participant failed to deactivate participant';
  END IF;

  -- Cleanup
  PERFORM public.delete_trip(test_ride_id);
END $$;

-- RT-003: Cascading account deletion via delete_user_account()
DO $$
DECLARE
  test_user_id uuid := '44444444-4444-4444-8444-444444444444';
  test_ride_id uuid;
BEGIN
  -- Bootstrap disposable user
  INSERT INTO auth.users VALUES (test_user_id, 'to_delete@example.test', '{"username":"deleteme","display_name":"DeleteMe"}');
  PERFORM set_config('request.jwt.claim.sub', test_user_id::text, true);

  -- Create a trip owned by this user
  test_ride_id := public.create_trip_plan(
    '{"name":"Delete Test Trip","trip_type":"solo","visibility":"private","origin":"Start","destination":"End","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Start","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"End","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb,
    NULL
  );

  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = test_ride_id AND admin_id = test_user_id) THEN
    RAISE EXCEPTION 'failed to create ride for account deletion test';
  END IF;

  -- Call delete_user_account()
  PERFORM public.delete_user_account();

  -- Verify cascades
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = test_user_id) THEN
    RAISE EXCEPTION 'profile remains after delete_user_account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rides WHERE id = test_ride_id) THEN
    RAISE EXCEPTION 'owned ride remains after delete_user_account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ride_participants WHERE user_id = test_user_id) THEN
    RAISE EXCEPTION 'ride participant remains after delete_user_account';
  END IF;
END $$;

RESET ROLE;
