-- Two lock-order fixes from the PR 39 review.
--
-- 1. Refund versus trip deletion. apply_registration_payment locked the
--    registration and then the ride; delete_trip deletes the ride and its
--    ON DELETE CASCADE then locks the registration. Run together, the two
--    could deadlock. The function now locks the ride first, then the
--    registration, which is the order the cascade uses.
--
-- 2. Stay arrivals versus the outbound queue lock. family_on_location wrote
--    the arrival row and then took the outbound_enqueue lock inside
--    notify_family. Two location batches for the same rider could each hold
--    one arrival row and wait for the other. The trigger now takes the
--    outbound_enqueue lock before it writes the arrival row, so every path
--    takes that lock first. The family text is also sent inside its own
--    block: if it fails, the location fix is still saved. Alerts get the
--    same guard, so a missed check-in or crash alert is never lost, and so
--    does ride start, so a ride always starts.

CREATE OR REPLACE FUNCTION public.apply_registration_payment(p_event_id text, p_registration_id uuid, p_status text, p_payment_id text, p_amount_paise integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.ride_registrations%ROWTYPE; v_refunded integer; v_ride_id uuid; v_ride_status text;
BEGIN
  -- Lock order: ride, then registration (the same order as a ride delete).
  SELECT ride_id INTO v_ride_id FROM public.ride_registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RETURN 'unknown_registration'; END IF;
  -- FOR SHARE also waits for a start_ride in progress, so a refund can't
  -- remove a rider from a ride that has just started.
  SELECT status INTO v_ride_status FROM public.rides WHERE id = v_ride_id FOR SHARE;
  IF NOT FOUND THEN RETURN 'unknown_registration'; END IF;
  SELECT * INTO g FROM public.ride_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND OR g.ride_id IS DISTINCT FROM v_ride_id THEN RETURN 'unknown_registration'; END IF;

  IF g.last_event_id = p_event_id THEN RETURN 'duplicate'; END IF;
  IF p_status NOT IN ('paid', 'failed', 'cancelled', 'refunded') THEN RETURN 'ignored_status'; END IF;
  IF p_status = 'paid' AND p_amount_paise IS DISTINCT FROM g.amount_paise THEN
    UPDATE public.ride_registrations SET last_event_id = p_event_id, updated_at = now() WHERE id = g.id;
    RETURN 'amount_mismatch';
  END IF;
  IF p_status = 'refunded' AND p_amount_paise IS NOT NULL THEN
    IF p_amount_paise <= 0 THEN RETURN 'ignored_status'; END IF;
    INSERT INTO public.ride_registration_refunds (event_id, registration_id, amount_paise)
    VALUES (p_event_id, g.id, p_amount_paise)
    ON CONFLICT (event_id) DO NOTHING;
    IF NOT FOUND THEN RETURN 'duplicate'; END IF;
    SELECT coalesce(sum(amount_paise), 0) INTO v_refunded FROM public.ride_registration_refunds WHERE registration_id = g.id;
    IF v_refunded < g.amount_paise THEN
      UPDATE public.ride_registrations SET last_event_id = p_event_id, updated_at = now() WHERE id = g.id;
      RETURN 'partial_refund';
    END IF;
  END IF;
  -- A replayed "paid" never brings back a registration that was refunded.
  IF g.status = 'refunded' AND p_status = 'paid' THEN
    UPDATE public.ride_registrations SET last_event_id = p_event_id, updated_at = now() WHERE id = g.id;
    RETURN 'already_refunded';
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
        AND v_ride_status = 'planned'
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

CREATE OR REPLACE FUNCTION public.family_on_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stay record; v_day date;
BEGIN
  -- Cheap exits first: this runs on every location insert.
  IF NOT EXISTS (SELECT 1 FROM public.family_contacts WHERE user_id = NEW.user_id AND NOT paused) THEN RETURN NEW; END IF;
  v_day := (coalesce(NEW."timestamp", now()) AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT s.id, s.name INTO v_stay FROM public.trip_stays s
   WHERE s.ride_id = NEW.ride_id AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
     AND (s.check_in IS NULL OR s.check_in = v_day)
     AND abs(s.latitude - NEW.lat) < 0.01 AND abs(s.longitude - NEW.lng) < 0.01
     AND public.distance_m(s.latitude, s.longitude, NEW.lat, NEW.lng) <= 500
     AND NOT EXISTS (SELECT 1 FROM public.family_stay_arrivals a WHERE a.ride_id = NEW.ride_id AND a.user_id = NEW.user_id AND a.stay_id = s.id)
   LIMIT 1;
  IF v_stay.id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = NEW.ride_id AND status = 'active') THEN RETURN NEW; END IF;
  -- Same lock enqueue_outbound_message takes, taken before the arrival row
  -- so the two are always locked in the same order. Only arrivals reach here.
  PERFORM pg_advisory_xact_lock(hashtext('outbound_enqueue'));
  INSERT INTO public.family_stay_arrivals (ride_id, user_id, stay_id) VALUES (NEW.ride_id, NEW.user_id, v_stay.id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.notify_family(NEW.ride_id, NEW.user_id, 'family_reached_stay', jsonb_build_object('stay', v_stay.name), 'family_stay:' || v_stay.id::text || ':' || NEW.user_id::text);
  EXCEPTION WHEN OTHERS THEN
    -- The location fix matters more than the family text.
    RAISE WARNING 'family_on_location: family text not queued: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.family_on_location() FROM PUBLIC, anon, authenticated;

-- Same guard for alerts: a missed check-in or a detected crash is saved even
-- if the family text for it cannot be queued.
CREATE OR REPLACE FUNCTION public.family_on_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type NOT IN ('check_in_missed', 'crash_detected') THEN RETURN NEW; END IF;
  BEGIN
    IF NEW.type = 'check_in_missed' THEN
      PERFORM public.notify_family(NEW.ride_id, NEW.user_id, 'family_check_in_missed', jsonb_build_object('minutes', '2'), 'family_checkin:' || NEW.id::text);
    ELSE
      PERFORM public.notify_family(NEW.ride_id, NEW.user_id, 'family_crash', '{}'::jsonb, 'family_crash:' || NEW.id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family_on_alert: family text not queued: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.family_on_alert() FROM PUBLIC, anon, authenticated;

-- And for ride start: a failed family text never stops a ride from starting.
CREATE OR REPLACE FUNCTION public.family_on_ride_started()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    FOR r IN SELECT user_id FROM public.ride_participants
              WHERE ride_id = NEW.id AND is_active AND attendance_status NOT IN ('absent', 'declined') LOOP
      BEGIN
        PERFORM public.notify_family(NEW.id, r.user_id, 'family_ride_started', '{}'::jsonb, 'family_start:' || NEW.id::text);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'family_on_ride_started: family text not queued: %', SQLERRM;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.family_on_ride_started() FROM PUBLIC, anon, authenticated;
