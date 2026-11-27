\set ON_ERROR_STOP on
-- Waitlist: signups only through the Edge Function (service role), rate limited
-- per network, and a place counts only once the email is confirmed.
RESET ROLE;
DELETE FROM public.waitlist_signups;
DELETE FROM public.waitlist_attempts;

-- Nobody can sign up straight through the API any more.
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.join_waitlist(text,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can call join_waitlist'; END IF;
  IF has_function_privilege('authenticated', 'public.join_waitlist(text,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'riders can call join_waitlist'; END IF;
  IF to_regprocedure('public.join_waitlist(text,text)') IS NOT NULL THEN RAISE EXCEPTION 'old join_waitlist still exists'; END IF;
  IF has_function_privilege('anon', 'public.waitlist_send_failed(text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can call waitlist_send_failed'; END IF;
  IF has_function_privilege('authenticated', 'public.waitlist_send_failed(text)', 'EXECUTE') THEN RAISE EXCEPTION 'riders can call waitlist_send_failed'; END IF;
END $$;

-- As the Edge Function (superuser here stands in for the service role).
DO $$
DECLARE r jsonb; t text; i int; ip text := repeat('a', 64);
BEGIN
  r := public.join_waitlist('  First@Example.TEST ', 'First Rider', ip);
  t := r->>'token';
  IF t !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'no confirmation token: %', r; END IF;
  IF public.waitlist_places_left() <> 10 THEN RAISE EXCEPTION 'unconfirmed signup took a place'; END IF;
  -- Asking again within 10 minutes sends nothing.
  IF public.join_waitlist('first@example.test', NULL, repeat('b', 64))->>'token' IS NOT NULL THEN RAISE EXCEPTION 'resent too soon'; END IF;
  PERFORM set_config('test.wl_first', t, false);

  BEGIN
    PERFORM public.join_waitlist('not-an-email', NULL, repeat('c', 64));
    RAISE EXCEPTION 'accepted a bad email';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.join_waitlist('long@example.test', repeat('x', 81), repeat('c', 64));
    RAISE EXCEPTION 'accepted a long name';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- Five tries an hour from one network, then refused.
  FOR i IN 1..5 LOOP PERFORM public.join_waitlist('spam' || i || '@example.test', NULL, repeat('d', 64)); END LOOP;
  BEGIN
    PERFORM public.join_waitlist('spam6@example.test', NULL, repeat('d', 64));
    RAISE EXCEPTION 'rate limit not applied';
  EXCEPTION WHEN SQLSTATE '53400' THEN NULL; END;

  -- Ten more people, from their own networks, confirm.
  FOR i IN 2..11 LOOP
    t := public.join_waitlist('rider' || i || '@example.test', NULL, repeat(to_hex(i), 32))->>'token';
    PERFORM set_config('test.wl_' || i, t, false);
  END LOOP;
END $$;

SET ROLE anon;
DO $$
DECLARE r jsonb; i int;
BEGIN
  IF (public.confirm_waitlist('nope')->>'status') <> 'invalid' THEN RAISE EXCEPTION 'bad token accepted'; END IF;
  IF (public.confirm_waitlist(repeat('0', 64))->>'status') <> 'invalid' THEN RAISE EXCEPTION 'unknown token accepted'; END IF;
  -- Places go in the order people confirm: rider2..rider11 confirm before First.
  FOR i IN 2..11 LOOP
    r := public.confirm_waitlist(current_setting('test.wl_' || i));
    IF r->>'status' <> 'confirmed' THEN RAISE EXCEPTION 'confirm failed: %', r; END IF;
    IF (r->>'early')::boolean IS DISTINCT FROM (i <= 11) THEN RAISE EXCEPTION 'wrong early flag for %', i; END IF;
  END LOOP;
  IF public.waitlist_places_left() <> 0 THEN RAISE EXCEPTION 'expected 0 places'; END IF;
  r := public.confirm_waitlist(current_setting('test.wl_first'));
  IF (r->>'early')::boolean THEN RAISE EXCEPTION 'eleventh confirmation should not be early'; END IF;
  -- Confirming twice keeps the answer.
  IF (public.confirm_waitlist(current_setting('test.wl_2'))->>'early')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'repeat confirm lost its place'; END IF;

  BEGIN
    IF EXISTS (SELECT 1 FROM public.waitlist_signups) THEN RAISE EXCEPTION 'anon can read the waitlist'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.waitlist_signups (email) VALUES ('direct@example.test');
    RAISE EXCEPTION 'anon can insert directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    IF EXISTS (SELECT 1 FROM public.waitlist_attempts) THEN RAISE EXCEPTION 'anon can read attempts'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.waitlist_signups) THEN RAISE EXCEPTION 'riders can read the waitlist'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- An unconfirmed link expires after 7 days; asking again sends a new one.
DO $$
DECLARE t text; t2 text;
BEGIN
  t := public.join_waitlist('late@example.test', NULL, repeat('e', 64))->>'token';
  UPDATE public.waitlist_signups SET confirm_sent_at = now() - interval '8 days' WHERE email = 'late@example.test';
  IF (public.confirm_waitlist(t)->>'status') <> 'expired' THEN RAISE EXCEPTION 'old link still works'; END IF;
  t2 := public.join_waitlist('late@example.test', NULL, repeat('e', 64))->>'token';
  IF t2 IS NULL OR t2 = t THEN RAISE EXCEPTION 'no fresh link'; END IF;
  IF (public.confirm_waitlist(t)->>'status') <> 'invalid' THEN RAISE EXCEPTION 'replaced link still works'; END IF;
  IF (SELECT name FROM public.waitlist_signups WHERE email = 'first@example.test') <> 'First Rider' THEN RAISE EXCEPTION 'first signup overwritten'; END IF;
END $$;
DELETE FROM public.waitlist_signups;
DELETE FROM public.waitlist_attempts;

-- The email didn't send: the unsent link is dropped and trying again sends a new one at once.
DO $$
DECLARE t1 text; t2 text;
BEGIN
  t1 := public.join_waitlist('bounce@example.test', NULL, repeat('e', 64))->>'token';
  IF t1 IS NULL THEN RAISE EXCEPTION 'no first token'; END IF;
  PERFORM public.waitlist_send_failed('Bounce@Example.test');
  IF (public.confirm_waitlist(t1))->>'status' <> 'invalid' THEN RAISE EXCEPTION 'unsent link still works'; END IF;
  t2 := public.join_waitlist('bounce@example.test', NULL, repeat('e', 64))->>'token';
  IF t2 IS NULL OR t2 = t1 THEN RAISE EXCEPTION 'retry after a failed send got no new link'; END IF;
END $$;
