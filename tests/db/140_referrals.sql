\set ON_ERROR_STOP on
-- F17: referral codes, credit once, never self, carried through sign-up metadata.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1700000-0000-4000-8000-000000000001', 'ref1@example.test', '{"username":"ref_inviter","display_name":"Ref Inviter"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_code text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1700000-0000-4000-8000-000000000001', true);
  v_code := public.get_my_referral_code();
  IF v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' THEN RAISE EXCEPTION 'bad code %', v_code; END IF;
  IF public.get_my_referral_code() <> v_code THEN RAISE EXCEPTION 'code not stable'; END IF;
  IF public.claim_referral(v_code, 'typed') THEN RAISE EXCEPTION 'self referral credited'; END IF;
  PERFORM set_config('test.ref_code', v_code, false);
END $$;

-- A new account that signs up with the code in its metadata is credited at once.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT 'f1700000-0000-4000-8000-000000000002', 'ref2@example.test',
       jsonb_build_object('username', 'ref_newbie', 'display_name', 'Ref Newbie', 'referral_code', lower(current_setting('test.ref_code')), 'referral_source', 'spectator');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1700000-0000-4000-8000-000000000003', 'ref3@example.test', '{"username":"ref_typo","display_name":"Ref Typo","referral_code":"ZZZZZZ"}');
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1700000-0000-4000-8000-000000000001', true);
  IF public.get_my_referral_count() <> 1 THEN RAISE EXCEPTION 'metadata referral not credited'; END IF;
  IF EXISTS (SELECT 1 FROM public.referral_attributions) THEN RAISE EXCEPTION 'referrer can read who joined'; END IF;

  -- Credited once only.
  PERFORM set_config('request.jwt.claim.sub', 'f1700000-0000-4000-8000-000000000002', true);
  IF public.claim_referral(current_setting('test.ref_code'), 'recap') THEN RAISE EXCEPTION 'credited twice'; END IF;
  IF EXISTS (SELECT 1 FROM public.referral_codes WHERE user_id <> auth.uid()) THEN RAISE EXCEPTION 'reads other codes'; END IF;

  -- A typo code at sign-up did not block the account; a typed code later still works.
  PERFORM set_config('request.jwt.claim.sub', 'f1700000-0000-4000-8000-000000000003', true);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN RAISE EXCEPTION 'bad code blocked sign-up'; END IF;
  IF NOT public.claim_referral(' ' || current_setting('test.ref_code') || ' ', 'typed') THEN RAISE EXCEPTION 'typed code not credited'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'f1700000-0000-4000-8000-000000000001', true);
  IF public.get_my_referral_count() <> 2 THEN RAISE EXCEPTION 'count wrong'; END IF;
  IF public.get_referral_code_for_link('no-such-token') IS NOT NULL THEN RAISE EXCEPTION 'code for unknown link'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.credit_referral(uuid,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'credit_referral callable'; END IF;
END $$;
