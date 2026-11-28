-- Audit finding 9: a refund marked the registration refunded but left the
-- rider on the ride. The rule now:
-- * A full refund before the ride starts takes the rider off the ride
--   (ride_participants.is_active = false), unless they lead it.
-- * Once the ride is active or completed the rider stays on it: dropping
--   someone from a live ride would hide them from the pack's safety view.
-- * A partial refund (less than the fee) keeps the paid spot.

CREATE OR REPLACE FUNCTION public.apply_registration_payment(p_event_id text, p_registration_id uuid, p_status text, p_payment_id text, p_amount_paise integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.ride_registrations%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.ride_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown_registration'; END IF;
  IF g.last_event_id = p_event_id THEN RETURN 'duplicate'; END IF;
  IF p_status NOT IN ('paid', 'failed', 'cancelled', 'refunded') THEN RETURN 'ignored_status'; END IF;
  IF p_status = 'paid' AND p_amount_paise IS DISTINCT FROM g.amount_paise THEN
    UPDATE public.ride_registrations SET last_event_id = p_event_id, updated_at = now() WHERE id = g.id;
    RETURN 'amount_mismatch';
  END IF;
  IF p_status = 'refunded' AND p_amount_paise IS NOT NULL AND p_amount_paise < g.amount_paise THEN
    UPDATE public.ride_registrations SET last_event_id = p_event_id, updated_at = now() WHERE id = g.id;
    RETURN 'partial_refund';
  END IF;
  -- A late "failed" never overwrites a payment that went through.
  IF g.status = 'paid' AND p_status IN ('failed', 'cancelled') THEN RETURN 'already_paid'; END IF;
  UPDATE public.ride_registrations SET
    status = p_status, payment_id = coalesce(p_payment_id, payment_id), last_event_id = p_event_id,
    paid_at = CASE WHEN p_status = 'paid' THEN now() ELSE paid_at END, updated_at = now()
   WHERE id = g.id;
  IF p_status = 'paid' THEN
    INSERT INTO public.ride_participants (ride_id, user_id) VALUES (g.ride_id, g.user_id)
    ON CONFLICT (ride_id, user_id) DO UPDATE SET is_active = true;
  ELSIF p_status = 'refunded' AND g.status = 'paid'
        AND (SELECT status FROM public.rides WHERE id = g.ride_id) = 'planned'
        AND NOT public.is_ride_leadership(g.ride_id, g.user_id) THEN
    UPDATE public.ride_participants SET is_active = false WHERE ride_id = g.ride_id AND user_id = g.user_id;
  END IF;
  RETURN p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_registration_payment(text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_registration_payment(text, uuid, text, text, integer) TO service_role;
  END IF;
END $$;
