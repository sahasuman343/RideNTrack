-- Audit finding 5: before server SMS goes live, one account must not be able
-- to spam a number or use up the global daily budget that real SOS texts need.
--
-- * SOS-class templates (sos_alert, crash_alert, check_in_missed and the
--   family versions) get their own per-user cap. A rider can raise
--   check_in_missed themselves, so before this they had no per-user limit.
-- * Every recipient number gets a daily cap across all senders, so family
--   contacts with self-declared consent can't be used to flood a stranger.
-- * Part of the global daily budget is kept for SOS-class messages only.
--   Routine texts stop at global_daily - sos_global_reserve; SOS stops at
--   global_daily.

ALTER TABLE public.outbound_limits
  ADD COLUMN IF NOT EXISTS sos_per_user_daily integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS per_recipient_daily integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS sos_global_reserve integer NOT NULL DEFAULT 300;

CREATE INDEX IF NOT EXISTS idx_outbound_recipient_time ON public.outbound_messages (recipient, created_at DESC);

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
  v_is_sos boolean := p_template IN ('sos_alert', 'crash_alert', 'check_in_missed', 'family_check_in_missed', 'family_crash');
  v_global integer;
BEGIN
  SELECT id INTO v_id FROM public.outbound_messages WHERE idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO v_limits FROM public.outbound_limits WHERE id;
  SELECT count(*) INTO v_global FROM public.outbound_messages
   WHERE created_at > now() - interval '1 day' AND status <> 'suppressed';

  IF v_global >= v_limits.global_daily
     OR (NOT v_is_sos AND v_global >= greatest(v_limits.global_daily - v_limits.sos_global_reserve, 0)) THEN
    v_status := 'suppressed'; v_reason := 'global_daily_cap';
  ELSIF EXISTS (
    SELECT 1 FROM public.outbound_messages
     WHERE recipient = p_recipient AND template = p_template
       AND ride_id IS NOT DISTINCT FROM p_ride_id
       AND status <> 'suppressed'
       AND created_at > now() - make_interval(mins => v_limits.per_recipient_template_minutes)
  ) THEN
    v_status := 'suppressed'; v_reason := 'duplicate_recent';
  ELSIF (
    SELECT count(*) FROM public.outbound_messages
     WHERE recipient = p_recipient AND created_at > now() - interval '1 day' AND status <> 'suppressed'
  ) >= v_limits.per_recipient_daily THEN
    v_status := 'suppressed'; v_reason := 'recipient_daily_cap';
  ELSIF v_is_sos AND p_user_id IS NOT NULL AND (
    SELECT count(*) FROM public.outbound_messages
     WHERE user_id = p_user_id AND created_at > now() - interval '1 day' AND status <> 'suppressed'
       AND template IN ('sos_alert', 'crash_alert', 'check_in_missed', 'family_check_in_missed', 'family_crash')
  ) >= v_limits.sos_per_user_daily THEN
    v_status := 'suppressed'; v_reason := 'user_sos_daily_cap';
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
