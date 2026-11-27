-- Store billing (decision 1, behind the store_billing flag). RevenueCat sends
-- webhooks to the revenuecat-webhook Edge Function, which calls these
-- service-role functions. Razorpay stays for real-world ride registration fees (F16).
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

ALTER TABLE public.trip_passes
  ADD COLUMN IF NOT EXISTS store_transaction_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'store' CHECK (source IN ('store', 'promo', 'club'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_passes_store_txn ON public.trip_passes (store_transaction_id) WHERE store_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.billing_events (
  event_id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  action text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM anon, authenticated;

-- Returns false when the event was already processed (webhooks retry).
CREATE OR REPLACE FUNCTION public.apply_billing_tier(p_event_id text, p_event_type text, p_user_id uuid, p_tier text, p_expires_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.billing_events (event_id, user_id, event_type, action) VALUES (p_event_id, p_user_id, p_event_type, 'set_tier:' || p_tier)
  ON CONFLICT (event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_tier NOT IN ('free', 'pro_tourer') THEN RAISE EXCEPTION 'Unknown tier' USING ERRCODE = '22023'; END IF;
  -- protect_subscription_tier only lets the service role change the tier.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles SET subscription_tier = p_tier, subscription_expires_at = p_expires_at WHERE id = p_user_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_billing_tier(text, text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_billing_pass(p_event_id text, p_event_type text, p_user_id uuid, p_ride_id uuid, p_transaction_id text, p_grant boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.billing_events (event_id, user_id, event_type, action) VALUES (p_event_id, p_user_id, p_event_type, CASE WHEN p_grant THEN 'grant_pass' ELSE 'revoke_pass' END)
  ON CONFLICT (event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_grant THEN
    IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id) THEN RAISE EXCEPTION 'Ride not found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.trip_passes (ride_id, purchased_by, status, store_transaction_id, source)
    VALUES (p_ride_id, p_user_id, 'active', p_transaction_id, 'store')
    ON CONFLICT (store_transaction_id) WHERE store_transaction_id IS NOT NULL DO NOTHING;
  ELSE
    UPDATE public.trip_passes SET status = 'refunded' WHERE store_transaction_id = p_transaction_id;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_billing_pass(text, text, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_billing_tier(text, text, uuid, text, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_billing_pass(text, text, uuid, uuid, text, boolean) TO service_role;
  END IF;
END $$;

COMMIT;
