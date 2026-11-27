-- Waitlist hardening: CAPTCHA, rate limit and email confirmation.
--
-- Before this, anyone could call join_waitlist straight from the API, and a
-- script could take all 10 free Pro places in a second with made-up emails.
-- Now:
--   * Signups go only through the waitlist-join Edge Function, which checks a
--     Cloudflare Turnstile token and calls join_waitlist with the service role.
--     The API no longer lets anon or riders call it.
--   * join_waitlist limits each network (a salted IP hash, never the IP
--     itself) to 5 tries an hour, and all signups to 300 an hour.
--   * A signup counts only after its email is confirmed through the link the
--     function emails. The launch offer goes to the first 10 who confirm.
--   * Both functions take a transaction lock, so a burst of parallel calls
--     can't slip past the rate limit or hand out more than 10 places.

BEGIN;

ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS confirm_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS confirm_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE INDEX IF NOT EXISTS waitlist_signups_confirmed ON public.waitlist_signups (confirmed_at, position) WHERE confirmed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.waitlist_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL CHECK (length(ip_hash) BETWEEN 16 AND 128),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_attempts_ip_time ON public.waitlist_attempts (ip_hash, at DESC);
ALTER TABLE public.waitlist_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist_attempts FROM anon, authenticated;

-- The old two-argument version was callable by anyone.
DROP FUNCTION IF EXISTS public.join_waitlist(text, text);

-- Service role only (waitlist-join Edge Function). Returns a confirmation
-- token to email, or null when nothing should be sent: already confirmed, or
-- a link went out less than 10 minutes ago.
CREATE OR REPLACE FUNCTION public.join_waitlist(p_email text, p_name text, p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.waitlist_signups%ROWTYPE;
  v_token text;
BEGIN
  IF p_ip_hash IS NULL OR length(p_ip_hash) < 16 THEN
    RAISE EXCEPTION 'Missing network id' USING ERRCODE = '22023';
  END IF;
  -- One caller at a time, so the counts below include every earlier attempt.
  PERFORM pg_advisory_xact_lock(hashtext('public.join_waitlist'));
  IF (SELECT count(*) FROM public.waitlist_attempts WHERE ip_hash = p_ip_hash AND at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.waitlist_attempts WHERE at > now() - interval '1 hour') >= 300 THEN
    RAISE EXCEPTION 'Too many tries. Wait a while and try again' USING ERRCODE = '53400';
  END IF;
  INSERT INTO public.waitlist_attempts (ip_hash) VALUES (p_ip_hash);
  DELETE FROM public.waitlist_attempts WHERE at < now() - interval '1 day';

  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 80 THEN
    RAISE EXCEPTION 'Name is too long' USING ERRCODE = '22023';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.waitlist_signups (email, name, confirm_token, confirm_sent_at)
  VALUES (v_email, v_name, v_token, now())
  ON CONFLICT (email) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.position IS NOT NULL THEN
    RETURN jsonb_build_object('token', v_token);
  END IF;

  SELECT * INTO v_row FROM public.waitlist_signups w WHERE w.email = v_email;
  IF v_row.confirmed_at IS NOT NULL OR v_row.confirm_sent_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('token', NULL);
  END IF;
  -- Unconfirmed: send a fresh link (the old one stops working).
  UPDATE public.waitlist_signups SET confirm_token = v_token, confirm_sent_at = now() WHERE position = v_row.position;
  RETURN jsonb_build_object('token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.join_waitlist(text, text, text) FROM PUBLIC, anon, authenticated;

-- Service role only: the confirmation email didn't send. Drops the unsent
-- link and its 10-minute cooldown, so trying again sends a fresh one.
CREATE OR REPLACE FUNCTION public.waitlist_send_failed(p_email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.waitlist_signups SET confirm_token = NULL, confirm_sent_at = NULL
   WHERE email = lower(btrim(coalesce(p_email, ''))) AND confirmed_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.waitlist_send_failed(text) FROM PUBLIC, anon, authenticated;

-- The link in the email. Links work for 7 days; confirming twice is fine.
CREATE OR REPLACE FUNCTION public.confirm_waitlist(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_row public.waitlist_signups%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO v_row FROM public.waitlist_signups WHERE confirm_token = p_token FOR UPDATE;
  IF v_row.position IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF v_row.confirmed_at IS NULL THEN
    IF v_row.confirm_sent_at < now() - interval '7 days' THEN RETURN jsonb_build_object('status', 'expired'); END IF;
    -- One confirmation at a time, so the count below sees every earlier one.
    PERFORM pg_advisory_xact_lock(hashtext('public.confirm_waitlist'));
    UPDATE public.waitlist_signups SET confirmed_at = clock_timestamp() WHERE position = v_row.position RETURNING * INTO v_row;
  END IF;
  -- Places go in the order people confirmed.
  RETURN jsonb_build_object(
    'status', 'confirmed',
    'early', (SELECT count(*) FROM public.waitlist_signups w
               WHERE w.confirmed_at IS NOT NULL
                 AND (w.confirmed_at, w.position) <= (v_row.confirmed_at, v_row.position)) <= public.waitlist_offer_places()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.waitlist_places_left() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT greatest(0, public.waitlist_offer_places() - (SELECT count(*) FROM public.waitlist_signups WHERE confirmed_at IS NOT NULL))::integer
$$;

REVOKE ALL ON FUNCTION public.confirm_waitlist(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_waitlist(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.waitlist_places_left() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waitlist_places_left() TO anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.join_waitlist(text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.waitlist_send_failed(text) TO service_role;
  END IF;
END $$;

COMMIT;
