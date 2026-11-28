-- Phone number sign-in (one-time code by SMS) alongside email and password.
--
-- 1. Accounts created with a phone have no email, so the profile trigger can
--    no longer derive a username from the email. Sign-up sends username and
--    display name in the metadata; a safe fallback covers anything else.
-- 2. Sign-in codes go out through the Supabase Auth "Send SMS" hook
--    (supabase/functions/auth-send-sms), not through outbound_messages, so
--    they never count against the daily budget reserved for SOS and family
--    texts. They get their own caps here instead, against SMS pumping.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fallback text := 'rider_' || left(replace(NEW.id::text, '-', ''), 10);
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(nullif(NEW.raw_user_meta_data->>'username', ''), nullif(split_part(NEW.email, '@', 1), ''), v_fallback),
    COALESCE(nullif(NEW.raw_user_meta_data->>'display_name', ''), nullif(split_part(NEW.email, '@', 1), ''), 'Rider'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Caps for sign-in codes. One row, tunable from the SQL editor.
CREATE TABLE IF NOT EXISTS public.auth_sms_limits (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  per_phone_hourly integer NOT NULL DEFAULT 5,
  per_phone_daily integer NOT NULL DEFAULT 10,
  global_daily integer NOT NULL DEFAULT 2000,
  -- Comma-separated E.164 prefixes allowed to receive codes. India only by
  -- default: international SMS costs more and is the usual pumping target.
  allowed_prefixes text NOT NULL DEFAULT '+91'
);
INSERT INTO public.auth_sms_limits (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- One row per code sent. Kept two days for the caps, then removed.
CREATE TABLE IF NOT EXISTS public.auth_sms_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sms_log_phone_time ON public.auth_sms_log (phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sms_log_time ON public.auth_sms_log (sent_at DESC);

ALTER TABLE public.auth_sms_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sms_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_sms_limits, public.auth_sms_log FROM PUBLIC, anon, authenticated;

-- Called by the Send SMS hook before it texts a code. Returns NULL when the
-- code may be sent (and counts it), or the reason it may not.
CREATE OR REPLACE FUNCTION public.claim_auth_sms(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits public.auth_sms_limits%ROWTYPE;
  v_phone text := '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_allowed boolean := false;
  v_prefix text;
BEGIN
  IF length(v_phone) < 9 OR length(v_phone) > 16 THEN RETURN 'invalid_phone'; END IF;
  SELECT * INTO v_limits FROM public.auth_sms_limits WHERE id;

  FOREACH v_prefix IN ARRAY string_to_array(replace(coalesce(v_limits.allowed_prefixes, '+91'), ' ', ''), ',') LOOP
    IF v_prefix <> '' AND v_phone LIKE v_prefix || '%' THEN v_allowed := true; END IF;
  END LOOP;
  IF NOT v_allowed THEN RETURN 'country_not_allowed'; END IF;

  -- Same pattern as enqueue_outbound_message: count under one lock so
  -- concurrent requests can't all pass a cap.
  PERFORM pg_advisory_xact_lock(hashtext('auth_sms_claim'));
  DELETE FROM public.auth_sms_log WHERE sent_at < now() - interval '2 days';

  IF (SELECT count(*) FROM public.auth_sms_log WHERE phone = v_phone AND sent_at > now() - interval '1 hour') >= v_limits.per_phone_hourly THEN
    RETURN 'phone_hourly_cap';
  END IF;
  IF (SELECT count(*) FROM public.auth_sms_log WHERE phone = v_phone AND sent_at > now() - interval '1 day') >= v_limits.per_phone_daily THEN
    RETURN 'phone_daily_cap';
  END IF;
  IF (SELECT count(*) FROM public.auth_sms_log WHERE sent_at > now() - interval '1 day') >= v_limits.global_daily THEN
    RETURN 'global_daily_cap';
  END IF;

  INSERT INTO public.auth_sms_log (phone) VALUES (v_phone);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_auth_sms(text) FROM PUBLIC, anon, authenticated;

-- A failed send gives the code back, so a provider outage doesn't lock riders out.
CREATE OR REPLACE FUNCTION public.release_auth_sms(p_phone text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.auth_sms_log
   WHERE id = (SELECT id FROM public.auth_sms_log
                WHERE phone = '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
                ORDER BY sent_at DESC LIMIT 1);
$$;
REVOKE ALL ON FUNCTION public.release_auth_sms(text) FROM PUBLIC, anon, authenticated;

-- Only the Send SMS hook (service role) may claim or release a code.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.auth_sms_limits, public.auth_sms_log TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_auth_sms(text), public.release_auth_sms(text) TO service_role;
  END IF;
END $$;

COMMIT;
