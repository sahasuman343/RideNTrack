\set ON_ERROR_STOP on
-- Migration 071: deleting an account removes its SMS rows (and the family
-- numbers in them) but its texts still count toward the day's caps.
RESET ROLE;
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c2600000-0000-4000-8000-000000000001', 'tally1@example.test', '{"username":"tally_rider_1","display_name":"Tally 1"}'),
  ('c2600000-0000-4000-8000-000000000002', 'tally2@example.test', '{"username":"tally_rider_2","display_name":"Tally 2"}')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.outbound_messages;
DELETE FROM public.outbound_deleted_tally;
UPDATE public.outbound_limits SET per_recipient_daily = 3, global_daily = 100, sos_global_reserve = 0 WHERE id;
DO $$
DECLARE
  u1 uuid := 'c2600000-0000-4000-8000-000000000001'; u2 uuid := 'c2600000-0000-4000-8000-000000000002'; v uuid;
BEGIN
  PERFORM public.enqueue_outbound_message(NULL, u1, '+910000026001', 'family_ride_started', '{}', 'tally-key-1');
  PERFORM public.enqueue_outbound_message(NULL, u1, '+910000026001', 'family_reached_stay', '{}', 'tally-key-2');
  PERFORM public.enqueue_outbound_message(NULL, u1, '+910000026001', 'family_crash', '{}', 'tally-key-3');
  -- A suppressed text was never sent, so it leaves no tally.
  PERFORM public.enqueue_outbound_message(NULL, u1, '+910000026001', 'sos_alert', '{}', 'tally-key-4');

  DELETE FROM auth.users WHERE id = u1;
  IF EXISTS (SELECT 1 FROM public.outbound_messages WHERE recipient = '+910000026001') THEN
    RAISE EXCEPTION 'deleted account left family numbers behind';
  END IF;
  IF (SELECT count(*) FROM public.outbound_deleted_tally) <> 3 THEN
    RAISE EXCEPTION 'expected 3 tallies, got %', (SELECT count(*) FROM public.outbound_deleted_tally);
  END IF;
  IF EXISTS (SELECT 1 FROM public.outbound_deleted_tally WHERE recipient_hash LIKE '%26001%') THEN
    RAISE EXCEPTION 'tally holds the number in clear';
  END IF;

  -- A new account texting the same number is still capped for the day.
  v := public.enqueue_outbound_message(NULL, u2, '+910000026001', 'family_ride_started', '{}', 'tally-key-5');
  IF (SELECT status_reason FROM public.outbound_messages WHERE id = v) IS DISTINCT FROM 'recipient_daily_cap' THEN
    RAISE EXCEPTION 'per-number cap reset by deleting the account';
  END IF;
  -- Other numbers are unaffected.
  v := public.enqueue_outbound_message(NULL, u2, '+910000026002', 'family_ride_started', '{}', 'tally-key-6');
  IF (SELECT status FROM public.outbound_messages WHERE id = v) <> 'queued' THEN RAISE EXCEPTION 'other number blocked'; END IF;

  -- Tallies older than a day are dropped and stop counting.
  UPDATE public.outbound_deleted_tally SET created_at = now() - interval '25 hours';
  v := public.enqueue_outbound_message(NULL, u2, '+910000026001', 'family_reached_stay', '{}', 'tally-key-7');
  IF (SELECT status FROM public.outbound_messages WHERE id = v) <> 'queued' THEN RAISE EXCEPTION 'old tallies still counted'; END IF;
  IF EXISTS (SELECT 1 FROM public.outbound_deleted_tally) THEN RAISE EXCEPTION 'old tallies not dropped'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.outbound_deleted_tally'::regclass) THEN RAISE EXCEPTION 'tally has no RLS'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outbound_deleted_tally') THEN RAISE EXCEPTION 'tally has a policy'; END IF;
END $$;
