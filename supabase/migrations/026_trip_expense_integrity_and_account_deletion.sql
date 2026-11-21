BEGIN;

ALTER TABLE public.rides ADD COLUMN expense_currency text NOT NULL DEFAULT 'INR';
-- Preserve the currency of existing ledgers. The FK below deliberately fails
-- the migration if a trip already mixes currencies; never relabel its amounts.
UPDATE public.rides r SET expense_currency = e.currency
FROM (SELECT ride_id, min(currency) AS currency FROM public.trip_expenses GROUP BY ride_id) e
WHERE r.id = e.ride_id;
ALTER TABLE public.rides ADD UNIQUE (id, expense_currency);
ALTER TABLE public.trip_expenses ADD FOREIGN KEY (ride_id, currency)
  REFERENCES public.rides (id, expense_currency) ON DELETE CASCADE;

CREATE POLICY "Split recipients belong to trip" ON public.trip_expense_splits
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.trip_expenses e JOIN public.rides r ON r.id = e.ride_id
    WHERE e.id = expense_id AND (r.admin_id = trip_expense_splits.user_id OR EXISTS (
      SELECT 1 FROM public.ride_participants rp WHERE rp.ride_id = r.id
        AND rp.user_id = trip_expense_splits.user_id AND rp.is_active
    ))
  ));

CREATE OR REPLACE FUNCTION public.add_trip_expense(
  p_ride_id UUID,
  p_title TEXT,
  p_amount NUMERIC(10, 2),
  p_category TEXT,
  p_split_user_ids UUID[],
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_expense_id UUID;
  v_num_users INT;
  v_split_amount NUMERIC(10, 2);
  v_remainder NUMERIC(10, 2);
  v_uid UUID;
  v_idx INT := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT (public.is_ride_participant(p_ride_id, v_caller_id) OR EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = v_caller_id)) THEN
    RAISE EXCEPTION 'Only active ride participants can record expenses.';
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Expense title cannot be empty.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero.';
  END IF;

  IF p_category NOT IN ('fuel', 'food', 'stay', 'toll', 'repairs', 'other') THEN
    RAISE EXCEPTION 'Invalid expense category: %', p_category;
  END IF;

  v_num_users := cardinality(p_split_user_ids);
  IF coalesce(v_num_users, 0) = 0 OR v_num_users <> (
    SELECT count(DISTINCT u) FROM unnest(p_split_user_ids) u
  ) THEN
    RAISE EXCEPTION 'Split members must be nonempty, unique and non-null.' USING ERRCODE = '23514';
  END IF;

  -- Validate that every split user is an active participant or the admin of this trip
  IF EXISTS (
    SELECT 1 FROM unnest(p_split_user_ids) u
    WHERE NOT (
      EXISTS (
        SELECT 1 FROM public.ride_participants
        WHERE ride_id = p_ride_id AND user_id = u AND is_active = true
      )
      OR EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = u)
    )
  ) THEN
    RAISE EXCEPTION 'All split participants must be active members of this trip.';
  END IF;

  INSERT INTO public.trip_expenses (ride_id, payer_id, title, amount, currency, category, split_type, notes)
  VALUES (p_ride_id, v_caller_id, trim(p_title), round(p_amount, 2),
          (SELECT expense_currency FROM public.rides WHERE id = p_ride_id), p_category, 'equal', p_notes)
  RETURNING id INTO v_expense_id;

  v_split_amount := trunc(p_amount / v_num_users, 2);
  v_remainder := round(p_amount - (v_split_amount * v_num_users), 2);

  FOREACH v_uid IN ARRAY p_split_user_ids LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.trip_expense_splits (expense_id, user_id, amount)
    VALUES (
      v_expense_id,
      v_uid,
      CASE WHEN v_idx = 1 THEN v_split_amount + v_remainder ELSE v_split_amount END
    );
  END LOOP;

  RETURN v_expense_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_trip_expense_summary(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_total_spend NUMERIC(10, 2) := 0;
  v_my_paid NUMERIC(10, 2) := 0;
  v_my_share NUMERIC(10, 2) := 0;
  v_category_breakdown JSONB;
  v_participants_balances JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT (public.is_ride_participant(p_ride_id, v_caller_id) OR EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = v_caller_id)) THEN
    RAISE EXCEPTION 'Only ride participants can view expense summaries.';
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_total_spend
  FROM public.trip_expenses
  WHERE ride_id = p_ride_id;

  SELECT coalesce(sum(amount), 0) INTO v_my_paid
  FROM public.trip_expenses
  WHERE ride_id = p_ride_id AND payer_id = v_caller_id;

  SELECT coalesce(sum(s.amount), 0) INTO v_my_share
  FROM public.trip_expense_splits s
  JOIN public.trip_expenses e ON e.id = s.expense_id
  WHERE e.ride_id = p_ride_id AND s.user_id = v_caller_id;

  SELECT coalesce(jsonb_object_agg(c.category, c.cat_total), '{}'::jsonb)
  INTO v_category_breakdown
  FROM (
    SELECT category, sum(amount) AS cat_total
    FROM public.trip_expenses
    WHERE ride_id = p_ride_id
    GROUP BY category
  ) c;

  -- Build balances for current active participants, payers, and split debtors to prevent orphaned debts
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', b.user_id,
      'display_name', b.display_name,
      'paid', b.paid,
      'share', b.share,
      'net', round(b.paid - b.share, 2)
    ) ORDER BY b.display_name
  ), '[]'::jsonb)
  INTO v_participants_balances
  FROM (
    SELECT
      u.user_id,
      coalesce(p.display_name, 'Rider') AS display_name,
      coalesce((SELECT sum(e.amount) FROM public.trip_expenses e WHERE e.ride_id = p_ride_id AND e.payer_id = u.user_id), 0) AS paid,
      coalesce((SELECT sum(s.amount) FROM public.trip_expense_splits s JOIN public.trip_expenses e ON e.id = s.expense_id WHERE e.ride_id = p_ride_id AND s.user_id = u.user_id), 0) AS share
    FROM (
      SELECT rp.user_id FROM public.ride_participants rp WHERE rp.ride_id = p_ride_id AND rp.is_active = true
      UNION
      SELECT e.payer_id AS user_id FROM public.trip_expenses e WHERE e.ride_id = p_ride_id
      UNION
      SELECT s.user_id FROM public.trip_expense_splits s JOIN public.trip_expenses e ON e.id = s.expense_id WHERE e.ride_id = p_ride_id
    ) u
    LEFT JOIN public.profiles p ON p.id = u.user_id
  ) b;

  RETURN jsonb_build_object(
    'currency', (SELECT expense_currency FROM public.rides WHERE id = p_ride_id),
    'total_spend', v_total_spend,
    'my_paid', v_my_paid,
    'my_share', v_my_share,
    'net_balance', round(v_my_paid - v_my_share, 2),
    'category_breakdown', v_category_breakdown,
    'participant_balances', v_participants_balances
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user_account(p_expected_user_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_expected_user_id IS NOT NULL AND p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Target user ID does not match authenticated identity' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.profiles WHERE id = v_user_id;

  DELETE FROM auth.users WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account identity was not deleted';
  END IF;
END;
$$;

COMMIT;
