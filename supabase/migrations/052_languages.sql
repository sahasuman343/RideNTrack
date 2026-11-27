-- F13 Hindi: family texts follow the contact's language, not the rider's.
-- The language travels in the outbound payload as "lang"; the sender uses the
-- Hindi DLT template when one is configured and falls back to English.

ALTER TABLE public.family_contacts
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi'));

CREATE OR REPLACE FUNCTION public.set_family_contact_language(p_id uuid, p_language text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF p_language NOT IN ('en', 'hi') THEN RAISE EXCEPTION 'Unsupported language' USING ERRCODE = '22023'; END IF;
  UPDATE public.family_contacts SET language = p_language WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_family_contact_language(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_contact_language(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_family(p_ride_id uuid, p_user_id uuid, p_template text, p_vars jsonb, p_event_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_rider text; v_ride text; v_link text; v_n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.family_contacts WHERE user_id = p_user_id AND NOT paused) THEN RETURN 0; END IF;
  SELECT coalesce(display_name, 'Your rider') INTO v_rider FROM public.profiles WHERE id = p_user_id;
  SELECT name INTO v_ride FROM public.rides WHERE id = p_ride_id;
  v_link := public.public_track_url(public.family_link_token(p_ride_id, p_user_id));
  FOR c IN SELECT * FROM public.family_contacts WHERE user_id = p_user_id AND NOT paused LOOP
    PERFORM public.enqueue_outbound_message(
      p_ride_id, p_user_id, c.phone, p_template,
      jsonb_build_object('rider', v_rider, 'ride', v_ride, 'link', v_link, 'lang', c.language) || coalesce(p_vars, '{}'::jsonb),
      p_event_key || ':' || c.id::text, c.channel, c.name);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_family(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- Hindi stays off until a native speaker has reviewed it (matches shared/flags.ts).
UPDATE public.app_flags SET enabled = false, description = 'F13/F18: language picker and following the phone language'
 WHERE key = 'languages';
