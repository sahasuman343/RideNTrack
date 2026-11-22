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
    'public.delete_user_account(uuid)'::regprocedure,
    'public.archive_trip(uuid)'::regprocedure,
    'public.unarchive_trip(uuid)'::regprocedure,
    'public.duplicate_trip(uuid,text,date)'::regprocedure,
    'public.seed_default_trip_checklists(uuid)'::regprocedure,
    'public.get_trip_checklists(uuid)'::regprocedure,
    'public.toggle_trip_checklist_item(uuid,boolean)'::regprocedure,
    'public.transfer_trip_leadership(uuid,uuid)'::regprocedure,
    'public.remove_trip_participant(uuid,uuid)'::regprocedure,
    'public.reject_trip_invitation(uuid)'::regprocedure,
    'public.add_trip_expense(uuid,text,numeric,text,uuid[],text)'::regprocedure,
    'public.delete_trip_expense(uuid)'::regprocedure,
    'public.get_trip_expenses(uuid)'::regprocedure,
    'public.get_trip_expense_summary(uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon',rpc,'EXECUTE') THEN
      RAISE EXCEPTION 'anonymous RPC access: %',rpc;
    END IF;
    IF NOT has_function_privilege('authenticated',rpc,'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated RPC access missing: %',rpc;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('anon','public.get_public_trips(integer,integer)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'anon access missing for public.get_public_trips';
  END IF;
  IF NOT has_function_privilege('authenticated','public.get_public_trips(integer,integer)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated access missing for public.get_public_trips';
  END IF;
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
DO $$ BEGIN
  UPDATE public.profiles SET blood_group = 'O+', fuel_tank_capacity_liters = 12, fuel_reserve_liters = 2 WHERE id = auth.uid();
  UPDATE public.profiles SET display_name = 'Owner' WHERE id = auth.uid();
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND blood_group = 'O+' AND fuel_reserve_liters = 2) THEN
    RAISE EXCEPTION 'Emergency and motorcycle fields were not preserved';
  END IF;
  BEGIN
    UPDATE public.profiles SET fuel_reserve_liters = 12 WHERE id = auth.uid();
    RAISE EXCEPTION 'Accepted reserve equal to tank capacity';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
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
  UPDATE public.rides SET estimated_distance_meters = 200000, estimated_duration_seconds = 7200 WHERE id = journal_trip_id;
  IF public.get_rider_analytics(owner_id) IS DISTINCT FROM analytics THEN
    RAISE EXCEPTION 'Planned distance changed completed ride statistics';
  END IF;
  UPDATE public.rides SET status = 'completed' WHERE id = journal_trip_id;
  IF (public.get_rider_analytics(owner_id)->>'total_distance_km')::numeric <> (analytics->>'total_distance_km')::numeric + 200 THEN
    RAISE EXCEPTION 'Completed route estimate missing';
  END IF;
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
  v_test_ride_code text;
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

  SELECT ride_code INTO v_test_ride_code FROM public.rides WHERE id = test_ride_id;

  -- 2. Member joins ride
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.join_ride_by_code(v_test_ride_code);

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

  -- 6b. New captain can add regroup points (verifies captain role in add_regroup_point)
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.add_regroup_point(test_ride_id, 'Captain regroup', 12.5, 77.5, 1, NULL, 'Added by captain');
  IF NOT EXISTS (SELECT 1 FROM public.trip_regroup_points WHERE ride_id = test_ride_id AND name = 'Captain regroup') THEN
    RAISE EXCEPTION 'captain role was unable to add regroup point';
  END IF;

  -- 6c. Direct hard delete on ride_participants must be blocked by RLS
  DELETE FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = member_id;
  IF NOT EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = member_id) THEN
    RAISE EXCEPTION 'direct hard deletion of ride participant was permitted';
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
RESET ROLE;
INSERT INTO auth.users VALUES ('44444444-4444-4444-8444-444444444444', 'to_delete@example.test', '{"username":"deleteme","display_name":"DeleteMe"}');
CREATE TABLE identity_hold (id uuid REFERENCES auth.users(id));
INSERT INTO identity_hold VALUES ('44444444-4444-4444-8444-444444444444');
GRANT DELETE ON identity_hold TO authenticated;
SET ROLE authenticated;

DO $$
DECLARE
  test_user_id uuid := '44444444-4444-4444-8444-444444444444';
  test_ride_id uuid;
BEGIN
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

  BEGIN
    PERFORM public.delete_user_account(gen_random_uuid());
    RAISE EXCEPTION 'mismatched account identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.delete_user_account(test_user_id);
    RAISE EXCEPTION 'identity deletion failure was suppressed';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = test_user_id) OR
     NOT EXISTS (SELECT 1 FROM public.rides WHERE id = test_ride_id) THEN
    RAISE EXCEPTION 'failed account deletion did not roll back';
  END IF;
  DELETE FROM identity_hold;

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

-- Phase 4 & Phase 7: Announcements, Group Expenses, and Public Discovery
DO $$
DECLARE
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  member_id uuid := '22222222-2222-4222-8222-222222222222';
  outsider_id uuid := '33333333-3333-4333-8333-333333333333';
  test_ride_id uuid;
  test_expense_id uuid;
  v_test_ride_code text;
  expenses jsonb;
  summary jsonb;
  public_trips jsonb;
BEGIN
  -- 1. Setup ride with owner and member
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  test_ride_id := public.create_trip_plan(
    '{"name":"Expenses & Public Tour","trip_type":"group","visibility":"public","origin":"Bengaluru","destination":"Chikmagalur","origin_coords":[77.59,12.97],"destination_coords":[75.78,13.31]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Bengaluru","latitude":12.97,"longitude":77.59},{"sequence":1,"waypoint_type":"destination","name":"Chikmagalur","latitude":13.31,"longitude":75.78}]'::jsonb,
    '[]'::jsonb,
    NULL
  );

  SELECT ride_code INTO v_test_ride_code FROM public.rides WHERE id = test_ride_id;

  -- Member joins
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM public.join_ride_by_code(v_test_ride_code);

  -- 2. Announcement Alert Check
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  INSERT INTO public.alerts (id, ride_id, user_id, type, message, lat, lng)
  VALUES (gen_random_uuid(), test_ride_id, owner_id, 'announcement', 'Fuel stop in 5km', 12.97, 77.59);

  -- 3. Add Group Expense
  test_expense_id := public.add_trip_expense(
    test_ride_id,
    'Highway Dhaba Lunch',
    600.00,
    'food',
    ARRAY[owner_id, member_id],
    'Split 50-50'
  );

  IF test_expense_id IS NULL THEN
    RAISE EXCEPTION 'add_trip_expense failed to return expense id';
  END IF;

  -- Verify splits created
  IF (SELECT count(*) FROM public.trip_expense_splits WHERE expense_id = test_expense_id) != 2 THEN
    RAISE EXCEPTION 'trip_expense_splits expected 2 rows';
  END IF;

  -- Verify get_trip_expenses
  expenses := public.get_trip_expenses(test_ride_id);
  IF jsonb_array_length(expenses) != 1 THEN
    RAISE EXCEPTION 'get_trip_expenses expected 1 expense, got %', jsonb_array_length(expenses);
  END IF;

  -- Verify get_trip_expense_summary from owner perspective
  summary := public.get_trip_expense_summary(test_ride_id);
  IF (summary->>'total_spend')::numeric != 600.00 THEN
    RAISE EXCEPTION 'total_spend expected 600.00, got %', summary->>'total_spend';
  END IF;
  IF (summary->>'my_paid')::numeric != 600.00 THEN
    RAISE EXCEPTION 'my_paid for owner expected 600.00, got %', summary->>'my_paid';
  END IF;
  IF (summary->>'my_share')::numeric != 300.00 THEN
    RAISE EXCEPTION 'my_share for owner expected 300.00, got %', summary->>'my_share';
  END IF;
  IF (summary->>'net_balance')::numeric != 300.00 THEN
    RAISE EXCEPTION 'net_balance for owner expected 300.00, got %', summary->>'net_balance';
  END IF;

  -- Verify member perspective
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  summary := public.get_trip_expense_summary(test_ride_id);
  IF (summary->>'my_paid')::numeric != 0.00 THEN
    RAISE EXCEPTION 'my_paid for member expected 0.00, got %', summary->>'my_paid';
  END IF;
  IF (summary->>'my_share')::numeric != 300.00 THEN
    RAISE EXCEPTION 'my_share for member expected 300.00, got %', summary->>'my_share';
  END IF;
  IF (summary->>'net_balance')::numeric != -300.00 THEN
    RAISE EXCEPTION 'net_balance for member expected -300.00, got %', summary->>'net_balance';
  END IF;

  -- 4. Delete Expense
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.delete_trip_expense(test_expense_id);
  IF EXISTS (SELECT 1 FROM public.trip_expenses WHERE id = test_expense_id) THEN
    RAISE EXCEPTION 'delete_trip_expense failed to delete expense';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trip_expense_splits WHERE expense_id = test_expense_id) THEN
    RAISE EXCEPTION 'delete_trip_expense failed to cascade delete splits';
  END IF;

  -- 5. Public Trips Discovery (outsider caller)
  PERFORM set_config('request.jwt.claim.sub', outsider_id::text, true);
  public_trips := public.get_public_trips(10, 0);
  IF jsonb_array_length(public_trips) < 1 THEN
    RAISE EXCEPTION 'get_public_trips expected at least 1 public trip, got %', jsonb_array_length(public_trips);
  END IF;

  -- Cleanup
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.delete_trip(test_ride_id);
END $$;

-- RT-008: Phases 1 to 3: Saved Places, Capacity Limits, Ride Rules, Attendance, and Access Controls
DO $$
DECLARE
  rider_a UUID := '11111111-1111-4111-8111-111111111111';
  rider_b UUID := '22222222-2222-4222-8222-222222222222';
  rider_c UUID := '33333333-3333-4333-8333-333333333333';
  test_place_id UUID;
  test_ride_id UUID;
  v_code TEXT;
  v_roster JSONB;
  v_capacity_blocked BOOLEAN := false;
BEGIN
  -- 1. Saved Places CRUD
  PERFORM set_config('request.jwt.claim.sub', rider_a::text, true);
  test_place_id := public.add_saved_place('Khardung La', 'pass', 34.2787, 77.6047, 'Leh Ladakh', 'Highest motorable pass');
  IF test_place_id IS NULL THEN
    RAISE EXCEPTION 'add_saved_place returned null id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.get_user_saved_places() WHERE id = test_place_id AND name = 'Khardung La') THEN
    RAISE EXCEPTION 'get_user_saved_places did not return newly created place';
  END IF;

  PERFORM public.delete_saved_place(test_place_id);
  IF EXISTS (SELECT 1 FROM public.get_user_saved_places() WHERE id = test_place_id) THEN
    RAISE EXCEPTION 'delete_saved_place failed to remove place';
  END IF;

  -- 2. Create Trip with Capacity and Rules
  test_ride_id := public.create_trip_plan(
    '{"name":"Himalayan Odyssey","description":"Adventure touring trip","origin":"Chandigarh","destination":"Manali","origin_coords":[76.7794,30.7333],"destination_coords":[77.1892,32.2396],"trip_type":"touring","start_date":"2026-07-01","end_date":"2026-07-07","total_distance_meters":300000,"estimated_duration_seconds":28800,"visibility":"private"}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Chandigarh","latitude":30.7333,"longitude":76.7794},{"sequence":1,"waypoint_type":"destination","name":"Manali","latitude":32.2396,"longitude":77.1892}]'::jsonb,
    '[]'::jsonb,
    NULL
  );

  SELECT ride_code INTO v_code FROM public.rides WHERE id = test_ride_id;

  -- Update access control to invite_only and set capacity to 2 riders
  PERFORM public.update_trip_access_control(test_ride_id, 'invite_only');
  PERFORM public.update_trip_capacity_and_rules(test_ride_id, 2, 'Full armor, boots, and 2-second spacing mandatory');

  IF (SELECT visibility FROM public.rides WHERE id = test_ride_id) != 'invite_only' THEN
    RAISE EXCEPTION 'update_trip_access_control failed to set visibility';
  END IF;

  IF (SELECT max_participants FROM public.rides WHERE id = test_ride_id) != 2 THEN
    RAISE EXCEPTION 'update_trip_capacity_and_rules failed to set max_participants';
  END IF;

  -- Rider B joins via code (occupies 2nd of 2 spots)
  PERFORM set_config('request.jwt.claim.sub', rider_b::text, true);
  PERFORM public.join_ride_by_code(v_code);

  -- Rider C attempts to join (should fail with capacity limit)
  PERFORM set_config('request.jwt.claim.sub', rider_c::text, true);
  BEGIN
    PERFORM public.join_ride_by_code(v_code);
  EXCEPTION WHEN OTHERS THEN
    v_capacity_blocked := true;
  END;

  IF NOT v_capacity_blocked THEN
    RAISE EXCEPTION 'join_ride_by_code failed to enforce max_participants capacity limit';
  END IF;

  -- 3. Attendance Status
  PERFORM set_config('request.jwt.claim.sub', rider_b::text, true);
  PERFORM public.update_participant_attendance(test_ride_id, 'tentative');
  IF (SELECT attendance_status FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = rider_b) != 'tentative' THEN
    RAISE EXCEPTION 'update_participant_attendance failed to set tentative status';
  END IF;

  -- Leader marks Rider B as attended
  PERFORM set_config('request.jwt.claim.sub', rider_a::text, true);
  PERFORM public.update_participant_attendance(test_ride_id, 'attended', rider_b);
  IF (SELECT attendance_status FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = rider_b) != 'attended' THEN
    RAISE EXCEPTION 'leader update_participant_attendance failed to mark rider as attended';
  END IF;

  -- 4. Co-Captain Role & Regroup Point
  PERFORM public.set_trip_participant_role(test_ride_id, rider_b, 'co-captain');
  IF (SELECT role FROM public.ride_participants WHERE ride_id = test_ride_id AND user_id = rider_b) != 'co-captain' THEN
    RAISE EXCEPTION 'set_trip_participant_role failed to promote to co-captain';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', rider_b::text, true);
  PERFORM public.add_regroup_point(test_ride_id, 'Co-captain viewpoint', 31.5, 77.1, 1, NULL, 'Check tires');
  IF NOT EXISTS (SELECT 1 FROM public.trip_regroup_points WHERE ride_id = test_ride_id AND name = 'Co-captain viewpoint') THEN
    RAISE EXCEPTION 'co-captain role was unable to add regroup point';
  END IF;

  -- Cleanup
  PERFORM set_config('request.jwt.claim.sub', rider_a::text, true);
  PERFORM public.delete_trip(test_ride_id);
END $$;

-- RT-009: Phase 4 & Phase 5 - Regroup point closure, announcement acknowledgement, emergency escalation, and breakdown assistance directory
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000091', 'lead91@example.test', '{"username":"lead_captain_91","display_name":"Lead Captain 91"}'),
  ('00000000-0000-0000-0000-000000000092', 'tail92@example.test', '{"username":"tail_sweep_92","display_name":"Tail Sweep 92"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, username, display_name) VALUES
  ('00000000-0000-0000-0000-000000000091', 'lead_captain_91', 'Lead Captain 91'),
  ('00000000-0000-0000-0000-000000000092', 'tail_sweep_92', 'Tail Sweep 92')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;

DO $$
DECLARE
  rider_lead UUID := '00000000-0000-0000-0000-000000000091';
  rider_tail UUID := '00000000-0000-0000-0000-000000000092';
  test_ride_id UUID;
  test_point_id UUID;
  test_alert_id UUID;
  test_emerg_id UUID;
  v_code TEXT;
  v_ack_count INT;
  v_dir_count INT;
BEGIN
  -- 1. Create Trip & Regroup Point
  PERFORM set_config('request.jwt.claim.sub', rider_lead::text, true);
  test_ride_id := public.create_trip_plan(
    '{"name":"Western Ghats Tour","description":"Monsoon expedition","origin":"Bangalore","destination":"Chikmagalur","origin_coords":[77.5946,12.9716],"destination_coords":[75.7720,13.3161],"trip_type":"touring","start_date":"2026-08-10","end_date":"2026-08-12","total_distance_meters":250000,"estimated_duration_seconds":18000,"visibility":"invite_only"}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Bangalore","latitude":12.9716,"longitude":77.5946},{"sequence":1,"waypoint_type":"destination","name":"Chikmagalur","latitude":13.3161,"longitude":75.7720}]'::jsonb,
    '[]'::jsonb,
    NULL
  );

  SELECT ride_code INTO v_code FROM public.rides WHERE id = test_ride_id;

  test_point_id := public.add_regroup_point(test_ride_id, 'Hassan Bypass Junction', 13.0068, 76.1004, 1, NULL, 'Refuel & chai');
  IF test_point_id IS NULL THEN
    RAISE EXCEPTION 'add_regroup_point failed to return point id';
  END IF;

  -- 2. Tail Sweep Joins Ride
  PERFORM set_config('request.jwt.claim.sub', rider_tail::text, true);
  PERFORM public.join_ride_by_code(v_code);

  -- Tail confirms arrival
  PERFORM public.confirm_regroup_arrival(test_point_id);

  -- 3. Leader closes regroup point
  PERFORM set_config('request.jwt.claim.sub', rider_lead::text, true);
  PERFORM public.close_regroup_point(test_point_id);

  IF (SELECT status FROM public.trip_regroup_points WHERE id = test_point_id) != 'closed' THEN
    RAISE EXCEPTION 'close_regroup_point failed to mark status as closed';
  END IF;

  IF (SELECT closed_at FROM public.trip_regroup_points WHERE id = test_point_id) IS NULL THEN
    RAISE EXCEPTION 'close_regroup_point failed to set closed_at timestamp';
  END IF;

  -- 4. Captain broadcasts announcement alert
  INSERT INTO public.alerts (ride_id, user_id, type, message, lat, lng)
  VALUES (test_ride_id, rider_lead, 'announcement', 'Rain on Charmadi Ghat — drop pace to 35 km/h', 13.05, 75.85)
  RETURNING id INTO test_alert_id;

  -- Tail acknowledges announcement
  PERFORM set_config('request.jwt.claim.sub', rider_tail::text, true);
  PERFORM public.acknowledge_alert(test_alert_id);

  SELECT count(*) INTO v_ack_count
  FROM public.get_alert_acknowledgements(test_alert_id);

  IF v_ack_count != 1 THEN
    RAISE EXCEPTION 'get_alert_acknowledgements failed to return tail rider acknowledgement';
  END IF;

  -- Duplicate acknowledgement is idempotent
  PERFORM public.acknowledge_alert(test_alert_id);
  SELECT count(*) INTO v_ack_count
  FROM public.get_alert_acknowledgements(test_alert_id);
  IF v_ack_count != 1 THEN
    RAISE EXCEPTION 'duplicate acknowledge_alert created duplicate row instead of ON CONFLICT DO NOTHING';
  END IF;

  -- 5. Emergency escalation
  INSERT INTO public.alerts (ride_id, user_id, type, message, lat, lng)
  VALUES (test_ride_id, rider_tail, 'emergency', 'Fallen tree on turn 14 — medical required', 13.06, 75.86)
  RETURNING id INTO test_emerg_id;

  PERFORM set_config('request.jwt.claim.sub', rider_lead::text, true);
  PERFORM public.escalate_emergency_alert(test_emerg_id, 'Escalated to local 108 ambulance and forest dept');

  IF (SELECT is_escalated FROM public.alerts WHERE id = test_emerg_id) != true THEN
    RAISE EXCEPTION 'escalate_emergency_alert failed to set is_escalated';
  END IF;

  -- 6. Breakdown assistance directory query
  SELECT count(*) INTO v_dir_count
  FROM public.get_breakdown_assistance_directory();

  IF v_dir_count < 3 THEN
    RAISE EXCEPTION 'get_breakdown_assistance_directory failed to return seeded breakdown services';
  END IF;

  -- Cleanup
  PERFORM public.delete_trip(test_ride_id);
END $$;

-- RT-010: CodeRabbit Security and Data Integrity Regression Checks (PR #7)
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000101', 'admin101@example.test', '{"username":"admin_user_101","display_name":"Admin 101"}'),
  ('00000000-0000-0000-0000-000000000102', 'member102@example.test', '{"username":"member_user_102","display_name":"Member 102"}'),
  ('00000000-0000-0000-0000-000000000103', 'outsider103@example.test', '{"username":"outsider_user_103","display_name":"Outsider 103"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, username, display_name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'admin_user_101', 'Admin 101'),
  ('00000000-0000-0000-0000-000000000102', 'member_user_102', 'Member 102'),
  ('00000000-0000-0000-0000-000000000103', 'outsider_user_103', 'Outsider 103')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;

DO $$
DECLARE
  v_admin UUID := '00000000-0000-0000-0000-000000000101';
  v_member UUID := '00000000-0000-0000-0000-000000000102';
  v_outsider UUID := '00000000-0000-0000-0000-000000000103';
  v_trip_id UUID;
  v_code TEXT;
  v_spoof_blocked BOOLEAN := false;
  v_seed_blocked BOOLEAN := false;
  v_split_blocked BOOLEAN := false;
  v_self_transfer_blocked BOOLEAN := false;
  v_summary JSONB;
  v_dup_trip_id UUID;
  v_sanitized_stay public.trip_stays%ROWTYPE;
BEGIN
  -- 1. Create Trip & Member
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_trip_id := public.create_trip_plan(
    '{"name":"CR Test Trip","description":"Audit fixes trip","origin":"Bangalore","destination":"Mysore","origin_coords":[77.5946,12.9716],"destination_coords":[76.6394,12.2958],"trip_type":"touring","start_date":"2026-09-01","end_date":"2026-09-02","total_distance_meters":150000,"estimated_duration_seconds":10800,"visibility":"public"}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"Bangalore","latitude":12.9716,"longitude":77.5946},{"sequence":1,"waypoint_type":"destination","name":"Mysore","latitude":12.2958,"longitude":76.6394}]'::jsonb,
    '[]'::jsonb,
    NULL
  );

  SELECT ride_code INTO v_code FROM public.rides WHERE id = v_trip_id;

  -- Add a stay with sensitive booking info
  PERFORM public.add_trip_stay(
    v_trip_id,
    '{"name":"Grand Palace Stay","stay_type":"hotel","price_amount":3500,"booking_reference":"SECRET-PNR-999","contact_phone":"+919999911111","notes":"Private gate passcode: 1234"}'::jsonb
  );

  -- Member joins
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM public.join_ride_by_code(v_code);

  -- 2. Test Announcement Spoofing: Member attempts to insert 'announcement' alert
  BEGIN
    INSERT INTO public.alerts (ride_id, user_id, type, message, lat, lng)
    VALUES (v_trip_id, v_member, 'announcement', 'Spoofed captain alert', 12.5, 77.0);
  EXCEPTION WHEN OTHERS THEN
    v_spoof_blocked := true;
  END;

  IF NOT v_spoof_blocked THEN
    RAISE EXCEPTION 'Non-admin member was able to insert announcement alert';
  END IF;

  -- Admin CAN insert announcement alert
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  INSERT INTO public.alerts (ride_id, user_id, type, message, lat, lng)
  VALUES (v_trip_id, v_admin, 'announcement', 'Legitimate captain alert', 12.5, 77.0);

  -- 3. Checklist Authorization: Outsider cannot seed checklists
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.seed_default_trip_checklists(v_trip_id);
  EXCEPTION WHEN OTHERS THEN
    v_seed_blocked := true;
  END;

  IF NOT v_seed_blocked THEN
    RAISE EXCEPTION 'Outsider was able to seed checklists into another trip';
  END IF;

  -- Admin can seed checklists
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.seed_default_trip_checklists(v_trip_id);

  -- 4. Self-transfer Leadership is blocked
  BEGIN
    PERFORM public.transfer_trip_leadership(v_trip_id, v_admin);
  EXCEPTION WHEN OTHERS THEN
    v_self_transfer_blocked := true;
  END;

  IF NOT v_self_transfer_blocked THEN
    RAISE EXCEPTION 'transfer_trip_leadership permitted transfer to self';
  END IF;

  -- 5. Ineligible split user in add_trip_expense is rejected
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.add_trip_expense(
      v_trip_id, 'Dinner', 1000, 'food',
      ARRAY[v_admin, v_outsider]::uuid[], 'Dinner split'
    );
  EXCEPTION WHEN OTHERS THEN
    v_split_blocked := true;
  END;

  IF NOT v_split_blocked THEN
    RAISE EXCEPTION 'add_trip_expense accepted non-member outsider in split';
  END IF;

  BEGIN
    PERFORM public.add_trip_expense(v_trip_id, 'Duplicate', 10, 'food', ARRAY[v_member, v_member]);
    RAISE EXCEPTION 'duplicate recipient accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.add_trip_expense(v_trip_id, 'Null', 10, 'food', ARRAY[v_member, NULL]);
    RAISE EXCEPTION 'null recipient accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.rides SET expense_currency = 'USD' WHERE id = v_trip_id;
  BEGIN
    INSERT INTO public.trip_expenses(ride_id, payer_id, title, amount, category, currency)
    VALUES (v_trip_id, v_admin, 'Mixed currency', 10, 'food', 'INR');
    RAISE EXCEPTION 'mixed currency accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Valid split works
  PERFORM public.add_trip_expense(
    v_trip_id, 'Highway Toll', 200, 'toll',
    ARRAY[v_admin, v_member]::uuid[], 'Fastag toll'
  );

  BEGIN
    INSERT INTO public.trip_expense_splits(expense_id, user_id, amount)
    SELECT id, v_outsider, 1 FROM public.trip_expenses WHERE ride_id = v_trip_id;
    RAISE EXCEPTION 'direct outsider split accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Member deactivates / leaves trip
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM public.leave_ride(v_trip_id);

  -- Summary still retains member balance
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_summary := public.get_trip_expense_summary(v_trip_id);
  IF v_summary->>'currency' IS DISTINCT FROM 'USD' OR (v_summary->>'total_spend')::numeric IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'unexpected expense currency or total';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_summary->'participant_balances') elem
    WHERE elem->>'user_id' = v_member::text AND (elem->>'share')::numeric = 100
  ) THEN
    RAISE EXCEPTION 'get_trip_expense_summary excluded former participant with pending balance';
  END IF;

  -- 6. Privacy: Outsider duplicates public trip -> Stay booking details are sanitized
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  v_dup_trip_id := public.duplicate_trip(v_trip_id, 'Outsider Clone Trip');

  SELECT * INTO v_sanitized_stay FROM public.trip_stays WHERE ride_id = v_dup_trip_id;
  IF v_sanitized_stay.booking_reference IS NOT NULL OR v_sanitized_stay.contact_phone IS NOT NULL OR v_sanitized_stay.notes IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_trip leaked private stay booking details to non-member cloner';
  END IF;

  -- Cleanup
  PERFORM public.delete_trip(v_dup_trip_id);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.delete_trip(v_trip_id);
END $$;

RESET ROLE;
