-- Account deletion removes the rider's outbound_messages rows, because they
-- hold family phone numbers. Until now that also removed them from the daily
-- caps, so someone could send texts, delete the account, sign up again and
-- get a fresh daily allowance for the same numbers.
--
-- Now, when a sent (not suppressed) row from the last day is deleted, an
-- anonymous tally row is kept instead: when it was sent, the ride, and a
-- SHA-256 hash of the number. No number, name, user or message text is kept.
-- enqueue_outbound_message adds the tallies to the global, per-number and
-- per-ride counts, and deletes tallies older than a day. The per-rider caps
-- don't carry over: a new account is a new rider, and the per-number and
-- global caps are what stop a flood.

CREATE TABLE IF NOT EXISTS public.outbound_deleted_tally (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL,
  ride_id uuid,
  recipient_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_tally_hash_time ON public.outbound_deleted_tally (recipient_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_tally_time ON public.outbound_deleted_tally (created_at);
ALTER TABLE public.outbound_deleted_tally ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_deleted_tally FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.outbound_deleted_tally_id_seq FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.outbound_keep_tally()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'suppressed' AND OLD.created_at > now() - interval '1 day' THEN
    INSERT INTO public.outbound_deleted_tally (created_at, ride_id, recipient_hash)
    VALUES (OLD.created_at, OLD.ride_id, encode(sha256(convert_to(coalesce(OLD.recipient, ''), 'UTF8')), 'hex'));
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.outbound_keep_tally() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS outbound_keep_tally ON public.outbound_messages;
CREATE TRIGGER outbound_keep_tally BEFORE DELETE ON public.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.outbound_keep_tally();

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
  v_hash text := encode(sha256(convert_to(coalesce(p_recipient, ''), 'UTF8')), 'hex');
BEGIN
  SELECT id INTO v_id FROM public.outbound_messages WHERE idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- Every enqueue takes the same lock before counting, so concurrent calls
  -- can't all pass a cap (per number, per rider or the global budget). One
  -- lock key for everything means a transaction that queues texts for many
  -- numbers (family fan-out, SOS) can never deadlock with another; the lock
  -- is re-entrant within a transaction. Volume is low, so the wait is short.
  PERFORM pg_advisory_xact_lock(hashtext('outbound_enqueue'));
  SELECT id INTO v_id FROM public.outbound_messages WHERE idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO v_limits FROM public.outbound_limits WHERE id;
  -- Tallies only matter for a day; drop the old ones while we hold the lock.
  DELETE FROM public.outbound_deleted_tally WHERE created_at <= now() - interval '1 day';
  SELECT count(*) INTO v_global FROM public.outbound_messages
   WHERE created_at > now() - interval '1 day' AND status <> 'suppressed';
  v_global := v_global + (SELECT count(*) FROM public.outbound_deleted_tally WHERE created_at > now() - interval '1 day');

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
  ) + (
    SELECT count(*) FROM public.outbound_deleted_tally
     WHERE recipient_hash = v_hash AND created_at > now() - interval '1 day'
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
  ) + (
    SELECT count(*) FROM public.outbound_deleted_tally
     WHERE ride_id = p_ride_id AND created_at > now() - interval '1 day'
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

