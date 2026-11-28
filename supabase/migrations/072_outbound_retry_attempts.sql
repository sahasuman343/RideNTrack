-- A retryable provider error re-queues the message. Count that attempt too,
-- so the sweep stops after MAX_ATTEMPTS instead of retrying forever.
-- Only delivery receipts ('delivered') leave the count alone.
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
         attempts = attempts + CASE WHEN p_status IN ('sent', 'failed', 'queued') THEN 1 ELSE 0 END,
         sent_at = CASE WHEN p_status IN ('sent', 'delivered') THEN COALESCE(sent_at, now()) ELSE sent_at END,
         updated_at = now()
   WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.mark_outbound_message(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.mark_outbound_message(uuid, text, text, text, text) TO service_role;
  END IF;
END $$;
