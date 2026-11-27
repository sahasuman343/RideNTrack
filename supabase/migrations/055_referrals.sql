-- F17 referral loop: one short code per rider, credited once per new account.

CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_codes FROM anon;
DROP POLICY IF EXISTS "Riders read own referral code" ON public.referral_codes;
CREATE POLICY "Riders read own referral code" ON public.referral_codes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.referral_attributions (
  referred_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL,
  source text NOT NULL DEFAULT 'typed' CHECK (source IN ('spectator', 'recap', 'profile', 'typed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referred_user_id <> referrer_user_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer ON public.referral_attributions (referrer_user_id, created_at DESC);
ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_attributions FROM anon;
-- No direct reads: the referrer sees a count, never who joined.

CREATE OR REPLACE FUNCTION public.get_my_referral_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT code INTO v_code FROM public.referral_codes WHERE user_id = auth.uid();
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  FOR attempt IN 1..20 LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.referral_codes (user_id, code) VALUES (auth.uid(), v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Same rider raced themselves: return the stored code; otherwise try another code.
      SELECT code INTO v_code FROM public.referral_codes WHERE user_id = auth.uid();
      IF v_code IS NOT NULL THEN RETURN v_code; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not create a referral code' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_referral_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM public.referral_attributions WHERE referrer_user_id = auth.uid();
$$;

-- Credit a code to the calling account: only within 14 days of sign-up, once, never self.
CREATE OR REPLACE FUNCTION public.claim_referral(p_code text, p_source text DEFAULT 'typed')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  RETURN public.credit_referral(auth.uid(), v_code, p_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_referral(p_user_id uuid, p_code text, p_source text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_referrer uuid; v_created timestamptz;
BEGIN
  IF NOT public.flag_enabled('referrals') THEN RETURN false; END IF;
  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = upper(p_code);
  IF v_referrer IS NULL OR v_referrer = p_user_id THEN RETURN false; END IF;
  SELECT created_at INTO v_created FROM public.profiles WHERE id = p_user_id;
  IF v_created IS NOT NULL AND v_created < now() - interval '14 days' THEN RETURN false; END IF;
  INSERT INTO public.referral_attributions (referred_user_id, referrer_user_id, code, source)
  VALUES (p_user_id, v_referrer, upper(p_code), CASE WHEN p_source IN ('spectator', 'recap', 'profile', 'typed') THEN p_source ELSE 'typed' END)
  ON CONFLICT (referred_user_id) DO NOTHING;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.credit_referral(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- A code typed or carried in a link at sign-up rides in the account metadata
-- and is credited as soon as the profile exists (also with email confirmation).
CREATE OR REPLACE FUNCTION public.referral_on_profile_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_meta jsonb;
BEGIN
  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = NEW.id;
  IF v_meta ? 'referral_code' THEN
    BEGIN
      PERFORM public.credit_referral(NEW.id, v_meta->>'referral_code', v_meta->>'referral_source');
    EXCEPTION WHEN others THEN
      NULL; -- A bad code must never block sign-up.
    END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_referral_on_profile_created ON public.profiles;
CREATE TRIGGER trg_referral_on_profile_created
  AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.referral_on_profile_created();

-- The spectator page's "Plan your own ride" link carries the sharing rider's code.
CREATE OR REPLACE FUNCTION public.get_referral_code_for_link(p_token text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rc.code
    FROM public.ride_share_links l
    JOIN public.referral_codes rc ON rc.user_id = coalesce(l.subject_user_id, l.created_by)
   WHERE l.token = p_token AND l.revoked_at IS NULL AND l.expires_at > now()
     AND public.flag_enabled('referrals')
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_referral_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_referral_count() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_referral(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_referral_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_referral_code_for_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_code_for_link(text) TO anon, authenticated;
