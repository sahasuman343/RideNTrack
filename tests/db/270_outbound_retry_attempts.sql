\set ON_ERROR_STOP on
-- Migration 072: a retryable failure re-queues the message and counts the attempt.
RESET ROLE;
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c2700000-0000-4000-8000-000000000001', 'retry1@example.test', '{"username":"retry_rider_1","display_name":"Retry 1"}')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.outbound_messages;
UPDATE public.outbound_limits SET per_recipient_daily = 10, global_daily = 100, sos_global_reserve = 0 WHERE id;
DO $$
DECLARE v uuid; n int;
BEGIN
  PERFORM public.enqueue_outbound_message(NULL, 'c2700000-0000-4000-8000-000000000001', '+910000027001', 'family_ride_started', '{}', 'retry-key-1');
  SELECT id INTO v FROM public.outbound_messages WHERE idempotency_key = 'retry-key-1';
  PERFORM public.mark_outbound_message(v, 'queued', 'test', NULL, 'timeout');
  PERFORM public.mark_outbound_message(v, 'queued', 'test', NULL, 'timeout');
  SELECT attempts INTO n FROM public.outbound_messages WHERE id = v;
  IF n <> 2 THEN RAISE EXCEPTION 'retries not counted: % attempts', n; END IF;
  PERFORM public.mark_outbound_message(v, 'sent', 'test', 'p1', NULL);
  PERFORM public.mark_outbound_message(v, 'delivered', 'test', NULL, NULL);
  SELECT attempts INTO n FROM public.outbound_messages WHERE id = v;
  IF n <> 3 THEN RAISE EXCEPTION 'delivery receipt counted as an attempt: %', n; END IF;
END $$;
ROLLBACK;
