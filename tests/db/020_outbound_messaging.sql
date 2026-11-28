\set ON_ERROR_STOP on
-- R2 outbound messaging: limits, idempotency, and clients never see numbers.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'ob1@example.test', '{"username":"ob_captain","display_name":"OB Captain"}'),
  ('b0000000-0000-4000-8000-000000000002', 'ob2@example.test', '{"username":"ob_rider","display_name":"OB Rider"}'),
  ('b0000000-0000-4000-8000-000000000003', 'ob3@example.test', '{"username":"ob_outsider","display_name":"OB Outsider"}')
ON CONFLICT (id) DO NOTHING;
CREATE TEMP TABLE ob_fixture (ride_id uuid);
GRANT ALL ON ob_fixture TO authenticated;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Outbound fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  INSERT INTO ob_fixture VALUES (v_ride);
  BEGIN
    PERFORM public.enqueue_outbound_message(v_ride, auth.uid(), '+919876543210', 'sos_alert', '{}'::jsonb, 'client-should-fail');
    RAISE EXCEPTION 'client queued a server SMS';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

UPDATE public.outbound_limits SET per_user_daily = 2, per_ride_daily = 3 WHERE id;
DO $$
DECLARE v_ride uuid := (SELECT ride_id FROM ob_fixture); v1 uuid; v2 uuid; v3 uuid;
BEGIN
  v1 := public.enqueue_outbound_message(v_ride, 'b0000000-0000-4000-8000-000000000002', '+919876543210', 'family_ride_started', '{"rider":"R"}', 'idem-key-0001');
  v2 := public.enqueue_outbound_message(v_ride, 'b0000000-0000-4000-8000-000000000002', '+919876543210', 'family_ride_started', '{"rider":"R"}', 'idem-key-0001');
  IF v1 <> v2 THEN RAISE EXCEPTION 'idempotency key not honoured'; END IF;
  -- Same recipient and template within ten minutes is suppressed, not sent twice.
  v3 := public.enqueue_outbound_message(v_ride, 'b0000000-0000-4000-8000-000000000002', '+919876543210', 'family_ride_started', '{}', 'idem-key-0002');
  IF (SELECT status_reason FROM public.outbound_messages WHERE id = v3) <> 'duplicate_recent' THEN RAISE EXCEPTION 'duplicate not suppressed'; END IF;
  PERFORM public.enqueue_outbound_message(v_ride, 'b0000000-0000-4000-8000-000000000002', '+919876543211', 'family_reached_stay', '{}', 'idem-key-0003');
  v3 := public.enqueue_outbound_message(v_ride, 'b0000000-0000-4000-8000-000000000002', '+919876543212', 'family_reached_stay', '{}', 'idem-key-0004');
  IF (SELECT status_reason FROM public.outbound_messages WHERE id = v3) <> 'user_daily_cap' THEN RAISE EXCEPTION 'per-user cap not applied'; END IF;
  -- An SOS is never blocked by the per-user cap.
  v3 := public.enqueue_outbound_message(v_ride, 'b0000000-0000-4000-8000-000000000002', '+919876543213', 'sos_alert', '{}', 'idem-key-0005');
  IF (SELECT status FROM public.outbound_messages WHERE id = v3) <> 'queued' THEN RAISE EXCEPTION 'SOS was capped'; END IF;
  PERFORM public.mark_outbound_message(v3, 'sent', 'msg91', 'req-1', NULL);
  IF (SELECT sent_at FROM public.outbound_messages WHERE id = v3) IS NULL THEN RAISE EXCEPTION 'sent_at not recorded'; END IF;
END $$;
UPDATE public.outbound_limits SET per_user_daily = 20, per_ride_daily = 60 WHERE id;

SET ROLE authenticated;
DO $$
DECLARE v_ride uuid := (SELECT ride_id FROM ob_fixture); v_hint text;
BEGIN
  -- Nobody reads the table directly.
  PERFORM set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
  IF EXISTS (SELECT 1 FROM public.outbound_messages) THEN RAISE EXCEPTION 'outbound numbers readable by rider'; END IF;
  -- The rider sees masked status for messages about them.
  SELECT recipient_hint INTO v_hint FROM public.get_outbound_status(v_ride) LIMIT 1;
  IF v_hint IS NULL OR v_hint LIKE '%9876%' THEN RAISE EXCEPTION 'status not masked: %', v_hint; END IF;
  IF (SELECT count(*) FROM public.get_outbound_status(v_ride) WHERE status = 'sent') <> 1 THEN RAISE EXCEPTION 'sent status not reported'; END IF;
  -- An outsider sees nothing.
  PERFORM set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
  IF EXISTS (SELECT 1 FROM public.get_outbound_status(v_ride)) THEN RAISE EXCEPTION 'outsider saw delivery status'; END IF;
  -- The captain sees the ride's messages.
  PERFORM set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
  IF (SELECT count(*) FROM public.get_outbound_status(v_ride)) < 4 THEN RAISE EXCEPTION 'captain cannot see delivery status'; END IF;
  PERFORM public.delete_trip(v_ride);
END $$;
RESET ROLE;
