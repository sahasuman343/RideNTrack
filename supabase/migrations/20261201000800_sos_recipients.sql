-- F6 SMS fallback for SOS. Decision 4: riders opt in to share their phone
-- number with their ride (profiles.share_phone_with_ride, consent like ICE).
-- get_ride_sos_recipients gives the rider who needs help the numbers of the
-- sweep and captain (if they opted in) plus their own emergency contact; the
-- app caches it at ride start. request_sos_sms queues server SMS to the same
-- people when there is some data (sent only once server SMS is live).
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS share_phone_with_ride boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_consent_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_phone_consent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.share_phone_with_ride IS TRUE AND (TG_OP = 'INSERT' OR OLD.share_phone_with_ride IS DISTINCT FROM TRUE) THEN
    NEW.phone_consent_at := now();
  ELSIF NEW.share_phone_with_ride IS DISTINCT FROM TRUE THEN
    NEW.phone_consent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS stamp_phone_consent ON public.profiles;
CREATE TRIGGER stamp_phone_consent BEFORE INSERT OR UPDATE OF share_phone_with_ride ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_phone_consent();

CREATE OR REPLACE FUNCTION public.get_ride_sos_recipients(p_ride_id uuid)
RETURNS TABLE (name text, role text, phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL OR public.ride_member_role(p_ride_id, auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not a member of this ride' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.rides WHERE id = p_ride_id;
  IF v_status NOT IN ('planned', 'active') THEN RETURN; END IF;
  RETURN QUERY
  SELECT 'Emergency contact'::text, 'emergency_contact'::text, p.emergency_contact
    FROM public.profiles p WHERE p.id = auth.uid() AND nullif(trim(p.emergency_contact), '') IS NOT NULL
  UNION ALL
  SELECT coalesce(p.display_name, 'Rider'), public.ride_member_role(p_ride_id, p.id), p.phone
    FROM public.ride_participants rp JOIN public.profiles p ON p.id = rp.user_id
   WHERE rp.ride_id = p_ride_id AND rp.is_active AND rp.user_id <> auth.uid()
     AND p.share_phone_with_ride AND nullif(trim(p.phone), '') IS NOT NULL
     AND public.ride_member_role(p_ride_id, p.id) IN ('captain', 'co-captain', 'sweeper');
END;
$$;

-- E.164 for numbers typed loosely in profiles (Indian default).
CREATE OR REPLACE FUNCTION public.to_e164(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');
BEGIN
  IF p_raw ~ '^\s*\+' AND length(d) BETWEEN 8 AND 15 AND left(d, 1) <> '0' THEN RETURN '+' || d; END IF;
  IF left(d, 2) = '00' AND length(d) BETWEEN 10 AND 17 THEN RETURN '+' || substr(d, 3); END IF;
  IF length(d) = 10 AND d ~ '^[6-9]' THEN RETURN '+91' || d; END IF;
  IF length(d) = 11 AND d ~ '^0[6-9]' THEN RETURN '+91' || substr(d, 2); END IF;
  IF length(d) = 12 AND d ~ '^91[6-9]' THEN RETURN '+' || d; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_sos_sms(p_alert_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_alert record; v_name text; v_ride text; v_maps text; r record; v_n integer := 0; v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  IF v_alert.id IS NULL OR v_alert.user_id <> auth.uid() OR v_alert.type NOT IN ('emergency', 'check_in_missed') THEN
    RAISE EXCEPTION 'Not your SOS' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(display_name, 'A rider') INTO v_name FROM public.profiles WHERE id = auth.uid();
  SELECT name INTO v_ride FROM public.rides WHERE id = v_alert.ride_id;
  v_maps := CASE WHEN v_alert.lat IS NOT NULL THEN 'https://maps.google.com/?q=' || round(v_alert.lat::numeric, 5) || ',' || round(v_alert.lng::numeric, 5)
                 ELSE 'no GPS fix' END;
  FOR r IN SELECT * FROM public.get_ride_sos_recipients(v_alert.ride_id) LOOP
    v_phone := public.to_e164(r.phone);
    CONTINUE WHEN v_phone IS NULL;
    PERFORM public.enqueue_outbound_message(v_alert.ride_id, auth.uid(), v_phone,
      CASE WHEN v_alert.type = 'check_in_missed' THEN 'check_in_missed' ELSE 'sos_alert' END,
      jsonb_build_object('rider', v_name, 'ride', v_ride, 'maps', v_maps),
      'sos:' || p_alert_id::text || ':' || v_phone, 'sms', r.name);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ride_sos_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_sos_recipients(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.request_sos_sms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_sos_sms(uuid) TO authenticated;

COMMIT;
