-- R2: outbound messaging service (server SMS, later WhatsApp).
-- Rows are written only by the service role or by SECURITY DEFINER triggers;
-- the send-outbound-message Edge Function delivers them through the configured
-- provider (MSG91 by default, DLT-registered templates). Clients never read
-- recipient numbers; they read masked delivery status through an RPC.
BEGIN;

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid REFERENCES public.rides(id) ON DELETE CASCADE,
  -- The rider the message is about (the one in trouble, the one who started riding).
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'whatsapp')),
  recipient text NOT NULL CHECK (recipient ~ '^\+[1-9][0-9]{7,14}$'),
  recipient_label text CHECK (recipient_label IS NULL OR char_length(recipient_label) <= 60),
  template text NOT NULL CHECK (template ~ '^[a-z][a-z0-9_]{2,47}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed')),
  status_reason text,
  provider text,
  provider_id text,
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbound_ride_time ON public.outbound_messages (ride_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_user_time ON public.outbound_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON public.outbound_messages (status, created_at) WHERE status IN ('queued', 'sending');

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_messages FROM anon, authenticated;

-- Limits live in one row so they can be tuned without a deploy.
CREATE TABLE IF NOT EXISTS public.outbound_limits (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  per_ride_daily integer NOT NULL DEFAULT 60,
  per_user_daily integer NOT NULL DEFAULT 20,
  per_recipient_template_minutes integer NOT NULL DEFAULT 10,
  global_daily integer NOT NULL DEFAULT 2000,
  spend_alert_daily integer NOT NULL DEFAULT 1000
);
INSERT INTO public.outbound_limits (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.outbound_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_limits FROM anon, authenticated;

/*
 * The single way to queue an outbound message. It never raises on a limit:
 * a limited message is stored as 'suppressed' with the reason, so the rider
 * sees "Failed" and the app falls back to the phone's own SMS composer.
 * SOS templates skip the per-user and per-ride caps (never block a rescue),
 * but keep the duplicate guard and the global ceiling.
 */
CREATE OR REPLACE FUNCTION public.enqueue_outbound_message(
  p_ride_id uuid,
  p_user_id uuid,
  p_recipient text,
  p_template text,
  p_payload jsonb,
  p_idempotency_key text,
  p_channel text DEFAULT 'sms',
  p_recipient_label text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits public.outbound_limits%ROWTYPE;
  v_id uuid;
  v_status text := 'queued';
  v_reason text;
  v_is_sos boolean := p_template IN ('sos_alert', 'crash_alert', 'check_in_missed', 'family_check_in_missed');
BEGIN
  SELECT id INTO v_id FROM public.outbound_messages WHERE idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO v_limits FROM public.outbound_limits WHERE id;

  IF (SELECT count(*) FROM public.outbound_messages WHERE created_at > now() - interval '1 day' AND status <> 'suppressed') >= v_limits.global_daily THEN
    v_status := 'suppressed'; v_reason := 'global_daily_cap';
  ELSIF EXISTS (
    SELECT 1 FROM public.outbound_messages
     WHERE recipient = p_recipient AND template = p_template
       AND ride_id IS NOT DISTINCT FROM p_ride_id
       AND status <> 'suppressed'
       AND created_at > now() - make_interval(mins => v_limits.per_recipient_template_minutes)
  ) THEN
    v_status := 'suppressed'; v_reason := 'duplicate_recent';
  ELSIF NOT v_is_sos AND p_ride_id IS NOT NULL AND (
    SELECT count(*) FROM public.outbound_messages
     WHERE ride_id = p_ride_id AND created_at > now() - interval '1 day' AND status <> 'suppressed'
  ) >= v_limits.per_ride_daily THEN
    v_status := 'suppressed'; v_reason := 'ride_daily_cap';
  ELSIF NOT v_is_sos AND p_user_id IS NOT NULL AND (
    SELECT count(*) FROM public.outbound_messages
     WHERE user_id = p_user_id AND created_at > now() - interval '1 day' AND status <> 'suppressed'
  ) >= v_limits.per_user_daily THEN
    v_status := 'suppressed'; v_reason := 'user_daily_cap';
  END IF;

  INSERT INTO public.outbound_messages (ride_id, user_id, channel, recipient, recipient_label, template, payload, status, status_reason, idempotency_key)
  VALUES (p_ride_id, p_user_id, COALESCE(p_channel, 'sms'), p_recipient, left(p_recipient_label, 60), p_template, COALESCE(p_payload, '{}'::jsonb), v_status, v_reason, p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.outbound_messages WHERE idempotency_key = p_idempotency_key;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_outbound_message(uuid, uuid, text, text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

-- The Edge Function reports back through this, so status changes stay in SQL.
CREATE OR REPLACE FUNCTION public.mark_outbound_message(p_id uuid, p_status text, p_provider text, p_provider_id text, p_reason text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.outbound_messages
     SET status = p_status,
         provider = COALESCE(p_provider, provider),
         provider_id = COALESCE(p_provider_id, provider_id),
         status_reason = p_reason,
         attempts = attempts + CASE WHEN p_status IN ('sent', 'failed') THEN 1 ELSE 0 END,
         sent_at = CASE WHEN p_status IN ('sent', 'delivered') THEN COALESCE(sent_at, now()) ELSE sent_at END,
         updated_at = now()
   WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.mark_outbound_message(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

/*
 * What a rider may see about messages sent about them in a ride: template,
 * status and the last two digits of the number. Ride captains see the same
 * for everyone in their ride (delivery of family updates and SOS texts).
 */
CREATE OR REPLACE FUNCTION public.get_outbound_status(p_ride_id uuid)
RETURNS TABLE (id uuid, user_id uuid, template text, status text, recipient_hint text, recipient_label text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.user_id, m.template,
         CASE WHEN m.status IN ('sent', 'delivered') THEN 'sent' WHEN m.status = 'suppressed' THEN 'failed' ELSE m.status END,
         '••' || right(m.recipient, 2),
         m.recipient_label,
         m.created_at
    FROM public.outbound_messages m
   WHERE m.ride_id = p_ride_id
     AND (
       m.user_id = auth.uid()
       OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = p_ride_id AND r.admin_id = auth.uid())
     )
   ORDER BY m.created_at DESC
   LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.get_outbound_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_outbound_status(uuid) TO authenticated;

-- Daily usage for the spend alert in the Edge Function and the dashboard.
CREATE OR REPLACE FUNCTION public.outbound_usage_today()
RETURNS TABLE (sent integer, suppressed integer, failed integer, over_spend_alert boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FILTER (WHERE status IN ('sent', 'delivered', 'sending', 'queued'))::integer,
         count(*) FILTER (WHERE status = 'suppressed')::integer,
         count(*) FILTER (WHERE status = 'failed')::integer,
         count(*) FILTER (WHERE status IN ('sent', 'delivered')) >= (SELECT spend_alert_daily FROM public.outbound_limits WHERE id)
    FROM public.outbound_messages
   WHERE created_at > now() - interval '1 day';
$$;
REVOKE ALL ON FUNCTION public.outbound_usage_today() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.outbound_messages, public.outbound_limits TO service_role;
    GRANT EXECUTE ON FUNCTION public.enqueue_outbound_message(uuid, uuid, text, text, jsonb, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.mark_outbound_message(uuid, text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.outbound_usage_today() TO service_role;
  END IF;
END $$;

COMMIT;
