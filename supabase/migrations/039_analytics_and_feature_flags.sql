-- R4: privacy-first product analytics and remote feature flags.
-- app_events holds no location, contact details or free text: the client
-- sanitises props (shared/analytics.ts) and log_app_events re-checks keys.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,47}$'),
  props jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object' AND pg_column_size(props) <= 2048),
  app_version text CHECK (app_version IS NULL OR char_length(app_version) <= 32),
  platform text CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_events_name_time ON public.app_events (name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_user_time ON public.app_events (user_id, occurred_at DESC);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
-- No client policies: riders write through log_app_events and nobody reads
-- events from the app. Dashboards use the service role.
REVOKE ALL ON public.app_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_app_events(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event jsonb;
  v_props jsonb;
  v_count integer := 0;
  v_key text;
  v_recent integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501';
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'Events must be an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_events) > 50 THEN
    RAISE EXCEPTION 'At most 50 events per batch' USING ERRCODE = '22023';
  END IF;
  -- A runaway client cannot flood the table: 2,000 events per rider per hour.
  SELECT count(*) INTO v_recent FROM public.app_events
   WHERE user_id = v_uid AND received_at > now() - interval '1 hour';
  IF v_recent >= 2000 THEN
    RETURN 0;
  END IF;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    v_props := COALESCE(v_event->'props', '{}'::jsonb);
    IF jsonb_typeof(v_props) <> 'object' THEN v_props := '{}'::jsonb; END IF;
    -- Defence in depth: drop any key that names a place or a person.
    FOR v_key IN SELECT jsonb_object_keys(v_props) LOOP
      IF v_key ~* '(^|_)(lat|lng|lon|latitude|longitude|coords?|location|position|phone|email|name|body|message|text|note|address|token)(_|$)'
         OR jsonb_typeof(v_props->v_key) IN ('object', 'array') THEN
        v_props := v_props - v_key;
      END IF;
    END LOOP;
    INSERT INTO public.app_events (id, user_id, session_id, name, props, app_version, platform, occurred_at)
    VALUES (
      (v_event->>'id')::uuid,
      v_uid,
      (v_event->>'session_id')::uuid,
      v_event->>'name',
      v_props,
      left(v_event->>'app_version', 32),
      CASE WHEN v_event->>'platform' IN ('ios', 'android', 'web') THEN v_event->>'platform' END,
      LEAST(COALESCE((v_event->>'occurred_at')::timestamptz, now()), now())
    )
    ON CONFLICT (id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.log_app_events(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_app_events(jsonb) TO authenticated;

-- Events older than 13 months are dropped by the existing retention job.
CREATE OR REPLACE FUNCTION public.purge_old_app_events(p_days integer DEFAULT 395)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.app_events WHERE occurred_at < now() - make_interval(days => GREATEST(p_days, 30));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_old_app_events(integer) FROM PUBLIC, anon, authenticated;

-- Remote feature flags ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  description text,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent integer NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  allow_user_ids uuid[] NOT NULL DEFAULT '{}',
  deny_user_ids uuid[] NOT NULL DEFAULT '{}',
  min_app_version text,
  payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;
-- Allow-lists name riders, so the table itself is not readable by clients.
REVOKE ALL ON public.app_flags FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_flags()
RETURNS TABLE (key text, enabled boolean, payload jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.key,
         CASE
           WHEN auth.uid() = ANY (f.deny_user_ids) THEN false
           WHEN auth.uid() = ANY (f.allow_user_ids) THEN true
           WHEN NOT f.enabled THEN false
           WHEN f.rollout_percent >= 100 THEN true
           WHEN f.rollout_percent <= 0 THEN false
           ELSE mod(abs(hashtext(f.key || ':' || COALESCE(auth.uid()::text, ''))), 100) < f.rollout_percent
         END AS enabled,
         f.payload
    FROM public.app_flags f
   WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_my_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_flags() TO authenticated;

-- Seed the flags for the four open product decisions and the betas. Values
-- match the app defaults (shared/flags.ts); change a row to change behaviour
-- without a release.
INSERT INTO public.app_flags (key, description, enabled) VALUES
  ('ride_attention_queue', 'R1: one attention bar on the live ride screen', true),
  ('crash_detection_beta', 'F7: crash countdown beta', false),
  ('sensor_recorder', 'F7-a: hidden sensor recorder for beta builds', false),
  ('store_billing', 'Decision 1: RevenueCat store billing for Pro and Expedition Pass', false),
  ('server_sms', 'Decision 2: server SMS via MSG91 (needs DLT approval)', false),
  ('free_safety_features', 'Decision 3: family links and voice notes free during a live ride', true),
  ('rider_phone_numbers', 'Decision 4: collect rider phone numbers (opt-in sharing inside a ride)', true),
  ('auto_roll_call', 'F1: automatic roll call by location', true),
  ('offline_map_packs', 'F5: automatic offline map packs', true),
  ('road_reports', 'F11: rider road reports', true),
  ('voice_notes', 'F12: push-to-talk voice notes', true),
  ('languages', 'F13/F18: language picker', true),
  ('clubs', 'F15: clubs', true),
  ('referrals', 'F17: referral loop', true),
  ('headset_autostart', 'F20: Android headset auto-start prompt', false),
  ('lock_screen_card', 'F9: lock-screen emergency card', true)
ON CONFLICT (key) DO NOTHING;

COMMIT;
