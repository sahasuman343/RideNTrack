\set ON_ERROR_STOP on
-- Store billing: webhook functions are idempotent and not callable by clients.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'bill1@example.test', '{"username":"bill_rider","display_name":"Bill Rider"}')
ON CONFLICT (id) DO NOTHING;
DO $$
DECLARE v_ride uuid;
BEGIN
  IF has_function_privilege('authenticated', 'public.apply_billing_tier(text, text, uuid, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'clients can call apply_billing_tier';
  END IF;
  IF has_function_privilege('authenticated', 'public.apply_billing_pass(text, text, uuid, uuid, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'clients can call apply_billing_pass';
  END IF;

  IF NOT public.apply_billing_tier('evt_1', 'INITIAL_PURCHASE', 'd0000000-0000-4000-8000-000000000001', 'pro_tourer', now() + interval '30 days') THEN
    RAISE EXCEPTION 'first event not applied';
  END IF;
  IF (SELECT subscription_tier FROM public.profiles WHERE id = 'd0000000-0000-4000-8000-000000000001') <> 'pro_tourer' THEN
    RAISE EXCEPTION 'tier not set';
  END IF;
  IF public.apply_billing_tier('evt_1', 'INITIAL_PURCHASE', 'd0000000-0000-4000-8000-000000000001', 'pro_tourer', now()) THEN
    RAISE EXCEPTION 'duplicate event applied twice';
  END IF;
  PERFORM public.apply_billing_tier('evt_2', 'EXPIRATION', 'd0000000-0000-4000-8000-000000000001', 'free', now());
  IF (SELECT subscription_tier FROM public.profiles WHERE id = 'd0000000-0000-4000-8000-000000000001') <> 'free' THEN
    RAISE EXCEPTION 'expiration did not drop tier';
  END IF;

  SELECT id INTO v_ride FROM public.rides LIMIT 1;
  IF v_ride IS NOT NULL THEN
    PERFORM public.apply_billing_pass('evt_3', 'NON_RENEWING_PURCHASE', 'd0000000-0000-4000-8000-000000000001', v_ride, 'GPA.42', true);
    PERFORM public.apply_billing_pass('evt_3b', 'NON_RENEWING_PURCHASE', 'd0000000-0000-4000-8000-000000000001', v_ride, 'GPA.42', true);
    IF (SELECT count(*) FROM public.trip_passes WHERE store_transaction_id = 'GPA.42') <> 1 THEN RAISE EXCEPTION 'pass duplicated'; END IF;
    PERFORM public.apply_billing_pass('evt_4', 'REFUND', 'd0000000-0000-4000-8000-000000000001', NULL, 'GPA.42', false);
    IF (SELECT status FROM public.trip_passes WHERE store_transaction_id = 'GPA.42') <> 'refunded' THEN RAISE EXCEPTION 'refund not applied'; END IF;
  END IF;
END $$;
