\set ON_ERROR_STOP on
-- Audit finding 5: SOS-class texts have a per-user cap, every number has a
-- daily cap, and part of the global budget is kept for SOS.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('c2200000-0000-4000-8000-00000000000' || n)::uuid, 'abuse' || n || '@example.test',
       jsonb_build_object('username', 'abuse_rider_' || n, 'display_name', 'Abuse ' || n)
  FROM generate_series(1, 9) n
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.outbound_messages;
UPDATE public.outbound_limits
   SET sos_per_user_daily = 2, per_recipient_daily = 3, global_daily = 10, sos_global_reserve = 4
 WHERE id;
DO $$
DECLARE
  u1 uuid := 'c2200000-0000-4000-8000-000000000001'; u2 uuid := 'c2200000-0000-4000-8000-000000000002'; v uuid; i integer;
BEGIN
  -- One rider raising check_in_missed over and over hits the SOS cap.
  PERFORM public.enqueue_outbound_message(NULL, u1, '+910000000001', 'check_in_missed', '{}', 'abuse-key-1');
  PERFORM public.enqueue_outbound_message(NULL, u1, '+910000000002', 'check_in_missed', '{}', 'abuse-key-2');
  v := public.enqueue_outbound_message(NULL, u1, '+910000000003', 'check_in_missed', '{}', 'abuse-key-3');
  IF (SELECT status_reason FROM public.outbound_messages WHERE id = v) IS DISTINCT FROM 'user_sos_daily_cap' THEN
    RAISE EXCEPTION 'SOS-class per-user cap not applied';
  END IF;
  -- A different rider's SOS still goes through.
  v := public.enqueue_outbound_message(NULL, u2, '+910000000004', 'sos_alert', '{}', 'abuse-key-4');
  IF (SELECT status FROM public.outbound_messages WHERE id = v) <> 'queued' THEN RAISE EXCEPTION 'unrelated SOS blocked'; END IF;

  -- One number gets at most per_recipient_daily texts a day, whoever sends them.
  PERFORM public.enqueue_outbound_message(NULL, 'c2200000-0000-4000-8000-000000000003'::uuid, '+910000000009', 'family_ride_started', '{}', 'abuse-key-5');
  PERFORM public.enqueue_outbound_message(NULL, 'c2200000-0000-4000-8000-000000000004'::uuid, '+910000000009', 'family_reached_stay', '{}', 'abuse-key-6');
  PERFORM public.enqueue_outbound_message(NULL, 'c2200000-0000-4000-8000-000000000005'::uuid, '+910000000009', 'family_crash', '{}', 'abuse-key-7');
  v := public.enqueue_outbound_message(NULL, 'c2200000-0000-4000-8000-000000000006'::uuid, '+910000000009', 'sos_alert', '{}', 'abuse-key-8');
  IF (SELECT status_reason FROM public.outbound_messages WHERE id = v) IS DISTINCT FROM 'recipient_daily_cap' THEN
    RAISE EXCEPTION 'per-recipient cap not applied';
  END IF;

  -- 6 sent so far (10 - 4 reserve = 6): routine texts now stop, SOS still sends.
  v := public.enqueue_outbound_message(NULL, 'c2200000-0000-4000-8000-000000000007'::uuid, '+910000000020', 'family_ride_started', '{}', 'abuse-key-9');
  IF (SELECT status_reason FROM public.outbound_messages WHERE id = v) IS DISTINCT FROM 'global_daily_cap' THEN
    RAISE EXCEPTION 'routine text used the SOS reserve';
  END IF;
  FOR i IN 1..4 LOOP
    v := public.enqueue_outbound_message(NULL, ('c2200000-0000-4000-8000-00000000000' || (5 + i))::uuid, '+91000000003' || i, 'sos_alert', '{}', 'abuse-sos-' || i);
    IF (SELECT status FROM public.outbound_messages WHERE id = v) <> 'queued' THEN RAISE EXCEPTION 'SOS blocked inside reserve (%)', i; END IF;
  END LOOP;
  v := public.enqueue_outbound_message(NULL, 'c2200000-0000-4000-8000-000000000009'::uuid, '+910000000040', 'sos_alert', '{}', 'abuse-key-sos-5');
  IF (SELECT status_reason FROM public.outbound_messages WHERE id = v) IS DISTINCT FROM 'global_daily_cap' THEN
    RAISE EXCEPTION 'global ceiling not applied to SOS';
  END IF;
END $$;
DELETE FROM public.outbound_messages;
UPDATE public.outbound_limits
   SET sos_per_user_daily = 30, per_recipient_daily = 12, global_daily = 2000, sos_global_reserve = 300
 WHERE id;
