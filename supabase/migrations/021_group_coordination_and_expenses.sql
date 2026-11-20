-- Phase 4 & Phase 7: Group Coordination, Announcements, Expenses, and Public Community Discovery
BEGIN;

-- 1. Expand alert types to include announcements
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('emergency','break','fuel','mechanical','route_deviation','rider_behind','regroup','announcement'));

-- 2. Allow public discovery of public rides and waypoints
DROP POLICY IF EXISTS "Rides viewable by participants" ON public.rides;
CREATE POLICY "Rides viewable by participants" ON public.rides
  FOR SELECT USING (
    visibility = 'public'
    OR admin_id = auth.uid()
    OR public.is_ride_participant(id, auth.uid())
  );

DROP POLICY IF EXISTS "Waypoints viewable by ride members" ON public.trip_waypoints;
CREATE POLICY "Waypoints viewable by ride members" ON public.trip_waypoints
  FOR SELECT USING (
    public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND (admin_id = auth.uid() OR visibility = 'public'))
  );

-- 3. Group Expenses & Bill Splitting Tables
CREATE TABLE IF NOT EXISTS public.trip_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  category TEXT NOT NULL CHECK (category IN ('fuel', 'food', 'stay', 'toll', 'repairs', 'other')),
  split_type TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'custom')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trip_expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.trip_expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_expenses_ride ON public.trip_expenses(ride_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_expense_splits_expense ON public.trip_expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_trip_expense_splits_user ON public.trip_expense_splits(user_id);

ALTER TABLE public.trip_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_expense_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Expenses viewable by ride participants" ON public.trip_expenses;
CREATE POLICY "Expenses viewable by ride participants" ON public.trip_expenses
  FOR SELECT TO authenticated
  USING (
    public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND admin_id = auth.uid())
  );

DROP POLICY IF EXISTS "Participants can add expenses" ON public.trip_expenses;
CREATE POLICY "Participants can add expenses" ON public.trip_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    payer_id = auth.uid()
    AND (
      public.is_ride_participant(ride_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND admin_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Payers or admins can delete expenses" ON public.trip_expenses;
CREATE POLICY "Payers or admins can delete expenses" ON public.trip_expenses
  FOR DELETE TO authenticated
  USING (
    payer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND admin_id = auth.uid())
  );

DROP POLICY IF EXISTS "Splits viewable by ride participants" ON public.trip_expense_splits;
CREATE POLICY "Splits viewable by ride participants" ON public.trip_expense_splits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_expenses e
      WHERE e.id = expense_id
        AND (
          public.is_ride_participant(e.ride_id, auth.uid())
          OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = e.ride_id AND r.admin_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Expense creators can insert splits" ON public.trip_expense_splits;
CREATE POLICY "Expense creators can insert splits" ON public.trip_expense_splits
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_expenses e
      WHERE e.id = expense_id AND e.payer_id = auth.uid()
    )
  );

-- 4. Atomic RPC: Add Trip Expense with Splits
CREATE OR REPLACE FUNCTION public.add_trip_expense(
  p_ride_id UUID,
  p_title TEXT,
  p_amount NUMERIC,
  p_category TEXT,
  p_split_user_ids UUID[],
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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

  v_num_users := coalesce(array_length(p_split_user_ids, 1), 0);
  IF v_num_users = 0 THEN
    RAISE EXCEPTION 'At least one participant must be included in the split.';
  END IF;

  INSERT INTO public.trip_expenses (ride_id, payer_id, title, amount, category, split_type, notes)
  VALUES (p_ride_id, v_caller_id, trim(p_title), round(p_amount, 2), p_category, 'equal', p_notes)
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

-- 5. Atomic RPC: Delete Trip Expense
CREATE OR REPLACE FUNCTION public.delete_trip_expense(
  p_expense_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_ride_id UUID;
  v_payer_id UUID;
  v_admin_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT e.ride_id, e.payer_id, r.admin_id
  INTO v_ride_id, v_payer_id, v_admin_id
  FROM public.trip_expenses e
  JOIN public.rides r ON r.id = e.ride_id
  WHERE e.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found.';
  END IF;

  IF v_caller_id != v_payer_id AND v_caller_id != v_admin_id THEN
    RAISE EXCEPTION 'Only the payer or ride captain can delete this expense.';
  END IF;

  DELETE FROM public.trip_expenses WHERE id = p_expense_id;
  RETURN TRUE;
END;
$$;

-- 6. Atomic RPC: Get Trip Expenses
CREATE OR REPLACE FUNCTION public.get_trip_expenses(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT (public.is_ride_participant(p_ride_id, v_caller_id) OR EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = v_caller_id)) THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'ride_id', e.ride_id,
      'payer_id', e.payer_id,
      'payer_name', coalesce(p.display_name, 'Rider'),
      'title', e.title,
      'amount', e.amount,
      'currency', e.currency,
      'category', e.category,
      'split_type', e.split_type,
      'notes', e.notes,
      'created_at', e.created_at,
      'splits', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'user_id', s.user_id,
            'display_name', coalesce(sp.display_name, 'Rider'),
            'amount', s.amount
          ) ORDER BY coalesce(sp.display_name, 'Rider')
        ), '[]'::jsonb)
        FROM public.trip_expense_splits s
        LEFT JOIN public.profiles sp ON sp.id = s.user_id
        WHERE s.expense_id = e.id
      )
    ) ORDER BY e.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.trip_expenses e
  LEFT JOIN public.profiles p ON p.id = e.payer_id
  WHERE e.ride_id = p_ride_id;

  RETURN v_result;
END;
$$;

-- 7. Atomic RPC: Get Trip Expense Summary
CREATE OR REPLACE FUNCTION public.get_trip_expense_summary(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_total_spend
  FROM public.trip_expenses WHERE ride_id = p_ride_id;

  SELECT coalesce(sum(amount), 0) INTO v_my_paid
  FROM public.trip_expenses WHERE ride_id = p_ride_id AND payer_id = v_caller_id;

  SELECT coalesce(sum(s.amount), 0) INTO v_my_share
  FROM public.trip_expense_splits s
  JOIN public.trip_expenses e ON e.id = s.expense_id
  WHERE e.ride_id = p_ride_id AND s.user_id = v_caller_id;

  SELECT coalesce(jsonb_object_agg(category, cat_sum), '{}'::jsonb)
  INTO v_category_breakdown
  FROM (
    SELECT category, round(sum(amount), 2) AS cat_sum
    FROM public.trip_expenses
    WHERE ride_id = p_ride_id
    GROUP BY category
  ) c;

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
      rp.user_id,
      coalesce(p.display_name, 'Rider') AS display_name,
      coalesce((SELECT sum(e.amount) FROM public.trip_expenses e WHERE e.ride_id = p_ride_id AND e.payer_id = rp.user_id), 0) AS paid,
      coalesce((SELECT sum(s.amount) FROM public.trip_expense_splits s JOIN public.trip_expenses e ON e.id = s.expense_id WHERE e.ride_id = p_ride_id AND s.user_id = rp.user_id), 0) AS share
    FROM public.ride_participants rp
    LEFT JOIN public.profiles p ON p.id = rp.user_id
    WHERE rp.ride_id = p_ride_id AND rp.is_active = true
  ) b;

  RETURN jsonb_build_object(
    'total_spend', v_total_spend,
    'my_paid', v_my_paid,
    'my_share', v_my_share,
    'net_balance', round(v_my_paid - v_my_share, 2),
    'category_breakdown', v_category_breakdown,
    'participant_balances', v_participants_balances
  );
END;
$$;

-- 8. Atomic RPC: Get Public Trips
CREATE OR REPLACE FUNCTION public.get_public_trips(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'description', r.description,
      'origin', r.origin,
      'destination', r.destination,
      'origin_coords', r.origin_coords,
      'destination_coords', r.destination_coords,
      'trip_type', r.trip_type,
      'start_date', r.start_date,
      'end_date', r.end_date,
      'estimated_distance_meters', r.estimated_distance_meters,
      'estimated_duration_seconds', r.estimated_duration_seconds,
      'organizer_name', coalesce(p.display_name, 'Tour Captain'),
      'participant_count', (SELECT count(*) FROM public.ride_participants WHERE ride_id = r.id AND is_active = true),
      'waypoint_count', (SELECT count(*) FROM public.trip_waypoints WHERE ride_id = r.id)
    ) ORDER BY r.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM public.rides
    WHERE visibility = 'public' AND status != 'archived'
    ORDER BY created_at DESC
    LIMIT greatest(1, least(50, p_limit))
    OFFSET greatest(0, p_offset)
  ) r
  LEFT JOIN public.profiles p ON p.id = r.admin_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.add_trip_expense(UUID, TEXT, NUMERIC, TEXT, UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_trip_expense(UUID, TEXT, NUMERIC, TEXT, UUID[], TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_trip_expense(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_trip_expense(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_trip_expenses(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_expenses(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_trip_expense_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_expense_summary(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_public_trips(INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_trips(INT, INT) TO authenticated, anon;

COMMIT;
