-- F16 club plan and paid registrations.
-- Club plan: a digital tier bought in the app through the stores (RevenueCat),
-- which unlocks Pro for every ride of the club.
-- Paid registration: a fee for a real-world ride (fuel, stay, support vehicle),
-- collected through a Razorpay payment link; the webhook marks it paid.

-- ----- Club plan ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_subscriptions (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'expired')),
  expires_at timestamptz,
  purchased_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_event_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_subscriptions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.club_subscriptions FROM authenticated;
DROP POLICY IF EXISTS "Club members see the club plan" ON public.club_subscriptions;
CREATE POLICY "Club members see the club plan" ON public.club_subscriptions FOR SELECT TO authenticated
  USING (public.club_role(club_id, auth.uid()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.club_plan_active(p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT status = 'active' AND (expires_at IS NULL OR expires_at > now())
                     FROM public.club_subscriptions WHERE club_id = p_club_id), false);
$$;
REVOKE ALL ON FUNCTION public.club_plan_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_plan_active(uuid) TO authenticated;

-- Webhook only (service role). Idempotent on the event id; the buyer must manage the club.
CREATE OR REPLACE FUNCTION public.apply_club_plan(p_event_id text, p_user_id uuid, p_club_id uuid, p_active boolean, p_expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.club_subscriptions WHERE club_id = p_club_id AND last_event_id = p_event_id) THEN RETURN false; END IF;
  IF p_active AND NOT public.is_club_admin(p_club_id, p_user_id) THEN
    RAISE EXCEPTION 'Buyer does not manage this club' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.club_subscriptions (club_id, status, expires_at, purchased_by, last_event_id, updated_at)
  VALUES (p_club_id, CASE WHEN p_active THEN 'active' ELSE 'expired' END, p_expires_at, p_user_id, p_event_id, now())
  ON CONFLICT (club_id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at,
    purchased_by = coalesce(EXCLUDED.purchased_by, club_subscriptions.purchased_by), last_event_id = EXCLUDED.last_event_id, updated_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_club_plan(text, uuid, uuid, boolean, timestamptz) FROM PUBLIC, anon, authenticated;

-- Pro for a ride now also comes from its club's plan.
CREATE OR REPLACE FUNCTION public.ride_has_pro_access(p_ride_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    JOIN public.profiles p ON p.id = r.admin_id
    WHERE r.id = p_ride_id
      AND p.subscription_tier = 'pro_tourer'
  )
  OR EXISTS (
    SELECT 1
    FROM public.trip_passes tp
    WHERE tp.ride_id = p_ride_id
      AND tp.status = 'active'
  )
  OR EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.id = p_ride_id AND r.club_id IS NOT NULL AND public.club_plan_active(r.club_id)
  );
$$;

-- ----- Paid registrations -------------------------------------------------
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS registration_fee_paise integer
  CHECK (registration_fee_paise IS NULL OR registration_fee_paise BETWEEN 100 AND 50000000);
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS registration_capacity integer
  CHECK (registration_capacity IS NULL OR registration_capacity BETWEEN 1 AND 500);
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS registration_note text
  CHECK (registration_note IS NULL OR char_length(registration_note) <= 280);

CREATE TABLE IF NOT EXISTS public.ride_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  provider text NOT NULL DEFAULT 'razorpay',
  payment_link_id text UNIQUE,
  payment_link_url text,
  payment_id text,
  last_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live registration per rider and ride; failed or cancelled ones can be retried.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ride_registrations_live ON public.ride_registrations (ride_id, user_id)
  WHERE status IN ('pending', 'paid');
ALTER TABLE public.ride_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_registrations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ride_registrations FROM authenticated;
-- Policy helper: only ever answers for the caller, so it is safe to expose.
CREATE OR REPLACE FUNCTION public.i_lead_ride(p_ride_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_ride_leadership(p_ride_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.i_lead_ride(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.i_lead_ride(uuid) TO authenticated;
DROP POLICY IF EXISTS "Riders see own registrations, captains see the ride's" ON public.ride_registrations;
CREATE POLICY "Riders see own registrations, captains see the ride's" ON public.ride_registrations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.i_lead_ride(ride_id));

CREATE OR REPLACE FUNCTION public.set_ride_registration(p_ride_id uuid, p_fee_inr numeric, p_capacity integer, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_ride_leadership(p_ride_id, auth.uid()) THEN RAISE EXCEPTION 'Only the ride captain can set a fee' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_fee_inr, 0) > 0 AND NOT public.flag_enabled('paid_registrations') THEN
    RAISE EXCEPTION 'Paid registration is not available yet' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ride_registrations WHERE ride_id = p_ride_id AND status = 'paid')
     AND (SELECT registration_fee_paise FROM public.rides WHERE id = p_ride_id) IS DISTINCT FROM round(coalesce(p_fee_inr, 0) * 100)::integer THEN
    RAISE EXCEPTION 'Riders have already paid; the fee cannot change' USING ERRCODE = '23514';
  END IF;
  UPDATE public.rides SET
    registration_fee_paise = CASE WHEN coalesce(p_fee_inr, 0) > 0 THEN round(p_fee_inr * 100)::integer ELSE NULL END,
    registration_capacity = CASE WHEN coalesce(p_fee_inr, 0) > 0 THEN p_capacity ELSE NULL END,
    registration_note = CASE WHEN coalesce(p_fee_inr, 0) > 0 THEN nullif(trim(p_note), '') ELSE NULL END
   WHERE id = p_ride_id AND status = 'planned';
  IF NOT FOUND THEN RAISE EXCEPTION 'Fees can only be set before the ride starts' USING ERRCODE = '22023'; END IF;
END;
$$;

-- Called by the create-registration-payment function (service role) before it creates the payment link.
CREATE OR REPLACE FUNCTION public.begin_ride_registration(p_ride_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rides%ROWTYPE; v_existing public.ride_registrations%ROWTYPE; v_id uuid; v_paid integer;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR r.registration_fee_paise IS NULL THEN RAISE EXCEPTION 'This ride has no registration fee' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'planned' THEN RAISE EXCEPTION 'Registration is closed' USING ERRCODE = '22023'; END IF;
  IF r.visibility <> 'public' AND NOT public.is_ride_participant(p_ride_id, p_user_id)
     AND NOT (r.club_id IS NOT NULL AND public.club_role(r.club_id, p_user_id) IS NOT NULL) THEN
    RAISE EXCEPTION 'Join the ride or the club first' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM public.ride_registrations WHERE ride_id = p_ride_id AND user_id = p_user_id AND status IN ('pending', 'paid');
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'amount_paise', v_existing.amount_paise,
                              'payment_link_url', v_existing.payment_link_url, 'ride_name', r.name);
  END IF;
  SELECT count(*) INTO v_paid FROM public.ride_registrations WHERE ride_id = p_ride_id AND status IN ('paid', 'pending');
  IF r.registration_capacity IS NOT NULL AND v_paid >= r.registration_capacity THEN
    RAISE EXCEPTION 'This ride is full' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.ride_registrations (ride_id, user_id, amount_paise) VALUES (p_ride_id, p_user_id, r.registration_fee_paise)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', 'pending', 'amount_paise', r.registration_fee_paise, 'payment_link_url', NULL, 'ride_name', r.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_registration_link(p_registration_id uuid, p_link_id text, p_link_url text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ride_registrations SET payment_link_id = p_link_id, payment_link_url = p_link_url, updated_at = now()
   WHERE id = p_registration_id AND status = 'pending';
$$;

-- Webhook only. Paid adds the rider to the ride. Idempotent on the event id.
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
  -- A late "failed" never overwrites a payment that went through.
  IF g.status = 'paid' AND p_status IN ('failed', 'cancelled') THEN RETURN 'already_paid'; END IF;
  UPDATE public.ride_registrations SET
    status = p_status, payment_id = coalesce(p_payment_id, payment_id), last_event_id = p_event_id,
    paid_at = CASE WHEN p_status = 'paid' THEN now() ELSE paid_at END, updated_at = now()
   WHERE id = g.id;
  IF p_status = 'paid' THEN
    INSERT INTO public.ride_participants (ride_id, user_id) VALUES (g.ride_id, g.user_id)
    ON CONFLICT (ride_id, user_id) DO UPDATE SET is_active = true;
  END IF;
  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ride_registration_summary(p_ride_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rides%ROWTYPE; v_lead boolean;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_lead := public.is_ride_leadership(p_ride_id, auth.uid());
  IF NOT (v_lead OR r.visibility = 'public' OR public.is_ride_participant(p_ride_id, auth.uid())
          OR (r.club_id IS NOT NULL AND public.club_role(r.club_id, auth.uid()) IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'fee_paise', r.registration_fee_paise,
    'capacity', r.registration_capacity,
    'note', r.registration_note,
    'paid_count', (SELECT count(*) FROM public.ride_registrations WHERE ride_id = p_ride_id AND status = 'paid'),
    'my_status', (SELECT status FROM public.ride_registrations WHERE ride_id = p_ride_id AND user_id = auth.uid()
                   ORDER BY CASE status WHEN 'paid' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at DESC LIMIT 1),
    'collected_paise', CASE WHEN v_lead THEN (SELECT coalesce(sum(amount_paise), 0) FROM public.ride_registrations WHERE ride_id = p_ride_id AND status = 'paid') END,
    'paid_user_ids', CASE WHEN v_lead THEN (SELECT coalesce(jsonb_agg(user_id), '[]'::jsonb) FROM public.ride_registrations WHERE ride_id = p_ride_id AND status = 'paid') END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_ride_registration(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_registration_link(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_registration_payment(text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_ride_registration(uuid, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ride_registration(uuid, numeric, integer, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_ride_registration_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_registration_summary(uuid) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_club_plan(text, uuid, uuid, boolean, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.begin_ride_registration(uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.attach_registration_link(uuid, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_registration_payment(text, uuid, text, text, integer) TO service_role;
  END IF;
END $$;

INSERT INTO public.app_flags (key, description, enabled) VALUES
  ('club_plan', 'F16: club plan sold through the stores (needs store_billing and club products)', false),
  ('paid_registrations', 'F16: paid ride registration through Razorpay payment links (needs Razorpay keys)', false)
ON CONFLICT (key) DO NOTHING;
