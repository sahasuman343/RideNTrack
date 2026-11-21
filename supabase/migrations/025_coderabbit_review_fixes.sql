-- Migration 025: CodeRabbit Security and Data Integrity Fixes for PR #7
BEGIN;

-- 1. Restrict 'announcement' alert type to ride admin in alerts INSERT policy
DROP POLICY IF EXISTS "Members insert own alerts" ON public.alerts;
CREATE POLICY "Members insert own alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_ride_participant(ride_id, auth.uid())
    AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
    AND (
      type IS DISTINCT FROM 'announcement'
      OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
    )
  );

-- 2. Authorize caller before seeding default trip checklists
CREATE OR REPLACE FUNCTION public.seed_default_trip_checklists(p_ride_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = p_ride_id AND r.admin_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only trip captain can seed checklists' USING ERRCODE = '42501';
  END IF;

  -- Prevent duplicate seeding if checklists already exist
  IF EXISTS (SELECT 1 FROM public.trip_checklists WHERE ride_id = p_ride_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.trip_checklists (ride_id, category, title, description, is_mandatory, sequence) VALUES
    (p_ride_id, 'fuel_tires', 'Tire Pressure & Tread Inspection', 'Check cold tire pressure and check tread depth for highway speeds.', true, 1),
    (p_ride_id, 'fuel_tires', 'Full Fuel Tank & Reserve Verified', 'Start the ride with a full tank and know your reserve distance.', true, 2),
    (p_ride_id, 'bike_inspection', 'Engine Oil & Coolant Levels', 'Inspect sight glass or dipstick on center stand.', true, 3),
    (p_ride_id, 'bike_inspection', 'Drive Chain Slack & Lubrication', 'Verify 20-30mm slack and clean, lubed links.', true, 4),
    (p_ride_id, 'bike_inspection', 'Brake Pads & Lights Check', 'Verify front/rear brake bite and brake light actuation.', true, 5),
    (p_ride_id, 'riding_gear', 'Full Helmet with Clean Visor', 'ECE/DOT/ISI certified helmet with scratch-free visor.', true, 6),
    (p_ride_id, 'riding_gear', 'Armored Jacket, Pants & Gloves', 'Wear CE Level 2 armor and full-gauntlet or reinforced gloves.', true, 7),
    (p_ride_id, 'riding_gear', 'Riding Boots with Ankle Support', 'Sturdy motorcycle boots preventing ankle torsion.', true, 8),
    (p_ride_id, 'documents', 'DL, RC, Insurance & PUC', 'Carry physical documents or verified Digilocker/mParivahan app copies.', true, 9),
    (p_ride_id, 'emergency_kit', 'First-Aid Kit & Tubeless Puncture Kit', 'Bandages, antiseptic, tire plugs, and portable inflator.', true, 10);
END;
$$;

-- 3. Lock the trip row with FOR UPDATE before captain check in transfer_trip_leadership and remove_trip_participant
CREATE OR REPLACE FUNCTION public.transfer_trip_leadership(p_ride_id UUID, p_new_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_new_admin_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot transfer leadership to yourself' USING ERRCODE = '23514';
  END IF;

  -- Lock the ride row to prevent concurrent leadership transfers
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = auth.uid() FOR UPDATE) THEN
    RAISE EXCEPTION 'Only the current trip captain can transfer leadership' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id = p_ride_id AND user_id = p_new_admin_id AND is_active = true) THEN
    RAISE EXCEPTION 'The new leader must be an active member of this trip' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.rides SET admin_id = p_new_admin_id WHERE id = p_ride_id;
  UPDATE public.ride_participants SET role = 'captain' WHERE ride_id = p_ride_id AND user_id = p_new_admin_id;
  UPDATE public.ride_participants SET role = 'co-captain' WHERE ride_id = p_ride_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_trip_participant(p_ride_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- Lock the ride row
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = auth.uid() FOR UPDATE) THEN
    RAISE EXCEPTION 'Only the trip captain can remove participants' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Captain cannot remove self; transfer leadership or delete the trip' USING ERRCODE = '23514';
  END IF;

  UPDATE public.ride_participants
  SET is_active = false
  WHERE ride_id = p_ride_id AND user_id = p_user_id;
END;
$$;

-- 4. Check recipient in reject_trip_invitation
CREATE OR REPLACE FUNCTION public.reject_trip_invitation(p_token UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_invite public.trip_invitations%ROWTYPE;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = auth.uid();

  SELECT * INTO v_invite FROM public.trip_invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_invite.invited_email IS NOT NULL AND v_invite.invited_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;

  UPDATE public.trip_invitations
  SET status = 'rejected'
  WHERE token = p_token;

  RETURN true;
END;
$$;

-- 5. Scope stay cloning in duplicate_trip to avoid leaking private booking info when duplicating public trips
CREATE OR REPLACE FUNCTION public.duplicate_trip(
  p_ride_id UUID,
  p_new_name TEXT,
  p_new_start_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_ride public.rides%ROWTYPE;
  v_new_ride_id UUID;
  v_new_code TEXT;
  v_days_offset INTEGER := 0;
  v_day_record RECORD;
  v_new_day_id UUID;
  v_day_map JSONB := '{}'::jsonb;
  v_stage_record RECORD;
  v_waypoint_record RECORD;
  v_stay_record RECORD;
  v_is_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_source_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source trip not found' USING ERRCODE = 'P0002';
  END IF;

  v_is_member := public.is_ride_participant(p_ride_id, auth.uid()) OR v_source_ride.admin_id = auth.uid();

  IF NOT v_is_member AND v_source_ride.visibility != 'public' THEN
    RAISE EXCEPTION 'You do not have permission to duplicate this trip' USING ERRCODE = '42501';
  END IF;

  v_new_code := upper(substring(md5(random()::text) from 1 for 6));
  IF p_new_start_date IS NOT NULL AND v_source_ride.start_date IS NOT NULL THEN
    v_days_offset := p_new_start_date - v_source_ride.start_date;
  END IF;

  INSERT INTO public.rides (
    id, name, ride_code, admin_id, origin, destination, origin_coords, destination_coords,
    route_geometry, status, description, trip_type, visibility, start_date, end_date,
    estimated_distance_meters, estimated_duration_seconds, route_deviation_threshold_meters,
    rider_behind_threshold_meters, max_participants, ride_rules
  ) VALUES (
    gen_random_uuid(),
    trim(p_new_name),
    v_new_code,
    auth.uid(),
    v_source_ride.origin,
    v_source_ride.destination,
    v_source_ride.origin_coords,
    v_source_ride.destination_coords,
    v_source_ride.route_geometry,
    'planned',
    v_source_ride.description,
    v_source_ride.trip_type,
    'invite_only',
    CASE WHEN v_source_ride.start_date IS NOT NULL THEN v_source_ride.start_date + v_days_offset ELSE NULL END,
    CASE WHEN v_source_ride.end_date IS NOT NULL THEN v_source_ride.end_date + v_days_offset ELSE NULL END,
    v_source_ride.estimated_distance_meters,
    v_source_ride.estimated_duration_seconds,
    v_source_ride.route_deviation_threshold_meters,
    v_source_ride.rider_behind_threshold_meters,
    v_source_ride.max_participants,
    v_source_ride.ride_rules
  ) RETURNING id INTO v_new_ride_id;

  INSERT INTO public.ride_participants (ride_id, user_id, role, is_active)
  VALUES (v_new_ride_id, auth.uid(), 'captain', true);

  -- Clone trip_days
  FOR v_day_record IN SELECT * FROM public.trip_days WHERE ride_id = p_ride_id ORDER BY day_number LOOP
    v_new_day_id := gen_random_uuid();
    v_day_map := jsonb_set(v_day_map, ARRAY[v_day_record.id::text], to_jsonb(v_new_day_id::text));
    INSERT INTO public.trip_days (id, ride_id, day_number, date, title, notes)
    VALUES (
      v_new_day_id, v_new_ride_id, v_day_record.day_number,
      CASE WHEN v_day_record.date IS NOT NULL THEN v_day_record.date + v_days_offset ELSE NULL END,
      v_day_record.title, v_day_record.notes
    );
  END LOOP;

  -- Clone trip_stages
  FOR v_stage_record IN SELECT * FROM public.trip_stages WHERE ride_id = p_ride_id ORDER BY sequence LOOP
    INSERT INTO public.trip_stages (
      id, ride_id, trip_day_id, stage_name, sequence, start_location, end_location,
      distance_meters, estimated_duration_seconds, notes
    ) VALUES (
      gen_random_uuid(), v_new_ride_id,
      CASE WHEN v_stage_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_stage_record.trip_day_id::text)::uuid ELSE NULL END,
      v_stage_record.stage_name, v_stage_record.sequence, v_stage_record.start_location,
      v_stage_record.end_location, v_stage_record.distance_meters,
      v_stage_record.estimated_duration_seconds, v_stage_record.notes
    );
  END LOOP;

  -- Clone trip_waypoints
  FOR v_waypoint_record IN SELECT * FROM public.trip_waypoints WHERE ride_id = p_ride_id ORDER BY sequence LOOP
    INSERT INTO public.trip_waypoints (
      id, ride_id, trip_day_id, name, latitude, longitude, sequence, waypoint_type,
      notes, road_condition, provider_place_id
    ) VALUES (
      gen_random_uuid(), v_new_ride_id,
      CASE WHEN v_waypoint_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_waypoint_record.trip_day_id::text)::uuid ELSE NULL END,
      v_waypoint_record.name, v_waypoint_record.latitude, v_waypoint_record.longitude,
      v_waypoint_record.sequence, v_waypoint_record.waypoint_type, v_waypoint_record.notes,
      v_waypoint_record.road_condition, v_waypoint_record.provider_place_id
    );
  END LOOP;

  -- Clone trip_stays (Sanitize private fields when cloner was not a member of source ride)
  FOR v_stay_record IN SELECT * FROM public.trip_stays WHERE ride_id = p_ride_id LOOP
    INSERT INTO public.trip_stays (
      id, ride_id, trip_day_id, name, stay_type, address, latitude, longitude,
      provider_place_id, check_in, check_out, booking_reference, price_amount,
      price_currency, contact_phone, notes
    ) VALUES (
      gen_random_uuid(), v_new_ride_id,
      CASE WHEN v_stay_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_stay_record.trip_day_id::text)::uuid ELSE NULL END,
      v_stay_record.name, v_stay_record.stay_type, v_stay_record.address, v_stay_record.latitude,
      v_stay_record.longitude, v_stay_record.provider_place_id, v_stay_record.check_in,
      v_stay_record.check_out,
      CASE WHEN v_is_member THEN v_stay_record.booking_reference ELSE NULL END,
      v_stay_record.price_amount,
      v_stay_record.price_currency,
      CASE WHEN v_is_member THEN v_stay_record.contact_phone ELSE NULL END,
      CASE WHEN v_is_member THEN v_stay_record.notes ELSE NULL END
    );
  END LOOP;

  RETURN v_new_ride_id;
END;
$$;

-- 6. Validate split user membership in add_trip_expense
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
  v_cleaned_splits UUID[];
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

  -- Remove nulls and duplicates
  SELECT array_agg(DISTINCT u) INTO v_cleaned_splits
  FROM unnest(p_split_user_ids) u
  WHERE u IS NOT NULL;

  v_num_users := coalesce(array_length(v_cleaned_splits, 1), 0);
  IF v_num_users = 0 THEN
    RAISE EXCEPTION 'At least one valid participant must be included in the split.';
  END IF;

  -- Validate that every split user is an active participant or the admin of this trip
  IF EXISTS (
    SELECT 1 FROM unnest(v_cleaned_splits) u
    WHERE NOT (
      public.is_ride_participant(p_ride_id, u)
      OR EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = u)
    )
  ) THEN
    RAISE EXCEPTION 'All split participants must be active members of this trip.';
  END IF;

  INSERT INTO public.trip_expenses (ride_id, payer_id, title, amount, category, split_type, notes)
  VALUES (p_ride_id, v_caller_id, trim(p_title), round(p_amount, 2), p_category, 'equal', p_notes)
  RETURNING id INTO v_expense_id;

  v_split_amount := trunc(p_amount / v_num_users, 2);
  v_remainder := round(p_amount - (v_split_amount * v_num_users), 2);

  FOREACH v_uid IN ARRAY v_cleaned_splits LOOP
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

-- 7. Retain outstanding balances for former participants in get_trip_expense_summary
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
    'total_spend', v_total_spend,
    'my_paid', v_my_paid,
    'my_share', v_my_share,
    'net_balance', round(v_my_paid - v_my_share, 2),
    'category_breakdown', v_category_breakdown,
    'participant_balances', v_participants_balances
  );
END;
$$;

-- 8. Safe account deletion with expected_user_id validation
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

  BEGIN
    DELETE FROM auth.users WHERE id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    -- If deleting from auth.users fails due to foreign service or environment permissions,
    -- profiles and cascading data are deleted.
    NULL;
  END;
END;
$$;

-- 9. Composite index on checklist ride_id and sequence
CREATE INDEX IF NOT EXISTS idx_trip_checklists_ride_seq ON public.trip_checklists (ride_id, sequence);

-- 10. Checklist completions policy with ride membership check
DROP POLICY IF EXISTS "Users manage own completions" ON public.trip_checklist_completions;
CREATE POLICY "Users manage own completions" ON public.trip_checklist_completions
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.trip_checklists c
      WHERE c.id = checklist_id AND public.is_ride_participant(c.ride_id, auth.uid())
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.trip_checklists c
      WHERE c.id = checklist_id AND public.is_ride_participant(c.ride_id, auth.uid())
    )
  );

COMMIT;
