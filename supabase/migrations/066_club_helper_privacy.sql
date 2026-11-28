-- Audit finding 7: club_role / is_club_admin told any signed-in user another
-- user's membership in any club. They now answer only about the caller, or
-- about someone in a club the caller belongs to (members already see the
-- roster). Calls with no JWT (service role, webhooks) are unchanged.
--
-- is_ride_participant already only answers for auth.uid(). That meant
-- begin_ride_registration, which runs as the service role, never saw ride
-- members of a private paid ride; it now checks ride_participants directly.

CREATE OR REPLACE FUNCTION public.club_role(p_club_id uuid, p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.role FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id
     AND (auth.uid() IS NULL
          OR p_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.club_members me WHERE me.club_id = p_club_id AND me.user_id = auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.club_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.begin_ride_registration(p_ride_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rides%ROWTYPE; v_existing public.ride_registrations%ROWTYPE; v_id uuid; v_paid integer;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR r.registration_fee_paise IS NULL THEN RAISE EXCEPTION 'This ride has no registration fee' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'planned' THEN RAISE EXCEPTION 'Registration is closed' USING ERRCODE = '22023'; END IF;
  IF r.visibility <> 'public' AND NOT EXISTS (SELECT 1 FROM public.ride_participants rp WHERE rp.ride_id = p_ride_id AND rp.user_id = p_user_id AND rp.is_active)
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
REVOKE ALL ON FUNCTION public.begin_ride_registration(uuid, uuid) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.begin_ride_registration(uuid, uuid) TO service_role;
  END IF;
END $$;
