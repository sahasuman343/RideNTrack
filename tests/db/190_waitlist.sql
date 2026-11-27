\set ON_ERROR_STOP on
-- Anyone can join the waitlist; nobody can read it through the API.
RESET ROLE;
DELETE FROM public.waitlist_signups;

SET ROLE anon;
DO $$
DECLARE r jsonb; i int;
BEGIN
  IF public.waitlist_places_left() <> 10 THEN RAISE EXCEPTION 'expected 10 places'; END IF;
  r := public.join_waitlist('  First@Example.TEST ', 'First Rider');
  IF NOT (r->>'early')::boolean THEN RAISE EXCEPTION 'first signup should be early'; END IF;
  -- Joining again keeps the first signup and the same answer.
  r := public.join_waitlist('first@example.test', NULL);
  IF NOT (r->>'early')::boolean THEN RAISE EXCEPTION 'repeat signup lost its place'; END IF;
  FOR i IN 2..10 LOOP PERFORM public.join_waitlist('rider' || i || '@example.test'); END LOOP;
  IF public.waitlist_places_left() <> 0 THEN RAISE EXCEPTION 'expected 0 places'; END IF;
  r := public.join_waitlist('eleventh@example.test');
  IF (r->>'early')::boolean THEN RAISE EXCEPTION 'eleventh signup should not be early'; END IF;

  BEGIN
    PERFORM public.join_waitlist('not-an-email');
    RAISE EXCEPTION 'accepted a bad email';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.join_waitlist('long@example.test', repeat('x', 81));
    RAISE EXCEPTION 'accepted a long name';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- Refused by grants in production, and by row security even where the table is granted.
  BEGIN
    IF EXISTS (SELECT 1 FROM public.waitlist_signups) THEN RAISE EXCEPTION 'anon can read the waitlist'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.waitlist_signups (email) VALUES ('direct@example.test');
    RAISE EXCEPTION 'anon can insert directly';
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

DO $$ BEGIN
  IF (SELECT count(*) FROM public.waitlist_signups) <> 11 THEN RAISE EXCEPTION 'expected 11 signups'; END IF;
  IF (SELECT name FROM public.waitlist_signups WHERE email = 'first@example.test') <> 'First Rider' THEN RAISE EXCEPTION 'first signup overwritten'; END IF;
END $$;
DELETE FROM public.waitlist_signups;
