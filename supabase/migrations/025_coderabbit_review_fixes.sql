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
  p_new_name TEXT DEFAULT NULL,
  p_new_start_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source public.rides%ROWTYPE;
  v_new_ride_id UUID := gen_random_uuid();
  v_new_code TEXT;
  v_name TEXT;
  v_day_record RECORD;
  v_new_day_id UUID;
  v_stage_record RECORD;
  v_new_stage_id UUID;
  v_wp_record RECORD;
  v_stay_record RECORD;
  v_day_map JSONB := '{}'::jsonb;
  v_stage_map JSONB := '{}'::jsonb;
  v_date_offset INTEGER := 0;
  v_is_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_source FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source trip not found' USING ERRCODE = 'P0002';
  END IF;

  v_is_member := v_source.admin_id = auth.uid() OR public.is_ride_participant(p_ride_id, auth.uid());

  IF NOT v_is_member AND v_source.visibility != 'public' THEN
    RAISE EXCEPTION 'You do not have permission to duplicate this trip' USING ERRCODE = '42501';
  END IF;

  v_new_code := public.generate_ride_code();
  v_name := COALESCE(NULLIF(trim(p_new_name), ''), v_source.name || ' (Copy)');

  IF p_new_start_date IS NOT NULL AND v_source.start_date IS NOT NULL THEN
    v_date_offset := p_new_start_date - v_source.start_date;
  END IF;

  -- Insert cloned ride (admin auto-join trigger handles participant creation)
  INSERT INTO public.rides (
    id, name, ride_code, admin_id, origin, destination,
    origin_coords, destination_coords, route_geometry, status,
    description, trip_type, visibility, start_date, end_date,
    estimated_distance_meters, estimated_duration_seconds,
    route_deviation_threshold_meters, rider_behind_threshold_meters,
    max_participants, ride_rules, created_at
  ) VALUES (
    v_new_ride_id, v_name, v_new_code, auth.uid(), v_source.origin, v_source.destination,
    v_source.origin_coords, v_source.destination_coords, v_source.route_geometry, 'planned',
    v_source.description, v_source.trip_type, 'private',
    CASE WHEN p_new_start_date IS NOT NULL THEN p_new_start_date ELSE v_source.start_date END,
    CASE WHEN v_source.end_date IS NOT NULL AND v_date_offset != 0 THEN v_source.end_date + v_date_offset ELSE v_source.end_date END,
    v_source.estimated_distance_meters, v_source.estimated_duration_seconds,
    v_source.route_deviation_threshold_meters, v_source.rider_behind_threshold_meters,
    v_source.max_participants, v_source.ride_rules, now()
  );

  -- Clone trip_days
  FOR v_day_record IN SELECT * FROM public.trip_days WHERE ride_id = p_ride_id ORDER BY day_number LOOP
    v_new_day_id := gen_random_uuid();
    v_day_map := jsonb_set(v_day_map, ARRAY[v_day_record.id::text], to_jsonb(v_new_day_id::text));

    INSERT INTO public.trip_days (id, ride_id, day_number, trip_date, title, notes)
    VALUES (
      v_new_day_id, v_new_ride_id, v_day_record.day_number,
      CASE WHEN v_day_record.trip_date IS NOT NULL AND v_date_offset != 0 THEN v_day_record.trip_date + v_date_offset ELSE v_day_record.trip_date END,
      v_day_record.title, v_day_record.notes
    );
  END LOOP;

  -- Clone trip_stages
  FOR v_stage_record IN SELECT * FROM public.trip_stages WHERE ride_id = p_ride_id ORDER BY stage_number LOOP
    v_new_stage_id := gen_random_uuid();
    v_stage_map := jsonb_set(v_stage_map, ARRAY[v_stage_record.id::text], to_jsonb(v_new_stage_id::text));

    INSERT INTO public.trip_stages (
      id, ride_id, trip_day_id, stage_number, name, start_name, destination_name,
      start_coords, destination_coords, route_geometry, estimated_distance_meters,
      estimated_duration_seconds, notes, status, created_at
    ) VALUES (
      v_new_stage_id, v_new_ride_id,
      CASE WHEN v_stage_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_stage_record.trip_day_id::text)::uuid ELSE NULL END,
      v_stage_record.stage_number, v_stage_record.name, v_stage_record.start_name, v_stage_record.destination_name,
      v_stage_record.start_coords, v_stage_record.destination_coords, v_stage_record.route_geometry,
      v_stage_record.estimated_distance_meters, v_stage_record.estimated_duration_seconds,
      v_stage_record.notes, 'planned', now()
    );
  END LOOP;

  -- Clone trip_waypoints
  FOR v_wp_record IN SELECT * FROM public.trip_waypoints WHERE ride_id = p_ride_id ORDER BY sequence LOOP
    INSERT INTO public.trip_waypoints (
      id, ride_id, sequence, waypoint_type, name, address, latitude, longitude,
      provider_place_id, notes, is_optional, planned_arrival, planned_departure,
      trip_day_id, trip_stage_id
    ) VALUES (
      gen_random_uuid(), v_new_ride_id, v_wp_record.sequence, v_wp_record.waypoint_type,
      v_wp_record.name, v_wp_record.address, v_wp_record.latitude, v_wp_record.longitude,
      v_wp_record.provider_place_id, v_wp_record.notes, v_wp_record.is_optional,
      v_wp_record.planned_arrival, v_wp_record.planned_departure,
      CASE WHEN v_wp_record.trip_day_id IS NOT NULL THEN (v_day_map->>v_wp_record.trip_day_id::text)::uuid ELSE NULL END,
      CASE WHEN v_wp_record.trip_stage_id IS NOT NULL THEN (v_stage_map->>v_wp_record.trip_stage_id::text)::uuid ELSE NULL END
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
      EXISTS (
        SELECT 1 FROM public.ride_participants
        WHERE ride_id = p_ride_id AND user_id = u AND is_active = true
      )
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
DROP FUNCTION IF EXISTS public.delete_user_account();
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

REVOKE ALL ON FUNCTION public.delete_user_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account(UUID) TO authenticated;

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

-- 11. Foreign key constraint on trip_regroup_points.closed_by to allow user deletion
ALTER TABLE public.trip_regroup_points
  DROP CONSTRAINT IF EXISTS trip_regroup_points_closed_by_fkey;
ALTER TABLE public.trip_regroup_points
  ADD CONSTRAINT trip_regroup_points_closed_by_fkey
  FOREIGN KEY (closed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 12. Restrict direct trip_stays reads to participants and admins (prevents non-member leak of booking info on public trips)
DROP POLICY IF EXISTS "Trip stays visible to ride members" ON public.trip_stays;
CREATE POLICY "Trip stays visible to ride members" ON public.trip_stays
  FOR SELECT USING (
    public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND admin_id = auth.uid())
  );

-- 13. Enforce private trip rule in join_ride_by_code & preserve role on conflict
CREATE OR REPLACE FUNCTION public.join_ride_by_code(p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_current_count INTEGER;
  v_already_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to join a ride'; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE ride_code = upper(trim(p_code)) AND status != 'completed';
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Invalid ride code or ride has ended'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ride_participants WHERE ride_id = v_ride.id AND user_id = auth.uid() AND is_active = true
  ) INTO v_already_member;

  IF NOT v_already_member AND v_ride.visibility = 'private' THEN
    RAISE EXCEPTION 'This trip is private. You need an invitation from the leader to join.' USING ERRCODE = '42501';
  END IF;

  IF NOT v_already_member AND v_ride.max_participants IS NOT NULL THEN
    PERFORM 1 FROM public.rides WHERE id = v_ride.id FOR UPDATE;
    SELECT count(*) INTO v_current_count FROM public.ride_participants
    WHERE ride_id = v_ride.id AND is_active = true;

    IF v_current_count >= v_ride.max_participants THEN
      RAISE EXCEPTION 'Group ride has reached maximum capacity (% riders)', v_ride.max_participants
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.ride_participants (ride_id, user_id, role, is_active, joined_at)
  VALUES (v_ride.id, auth.uid(), 'member', true, now())
  ON CONFLICT (ride_id, user_id)
  DO UPDATE SET is_active = true;

  RETURN v_ride.id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_ride_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_ride_by_code(text) TO authenticated;

-- 14. Serialize capacity check in accept_trip_invitation
CREATE OR REPLACE FUNCTION public.accept_trip_invitation(p_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_inv public.trip_invitations%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_email TEXT;
  v_current_count INTEGER;
  v_already_member BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id=auth.uid();
  SELECT * INTO v_inv FROM public.trip_invitations i
    WHERE i.token=p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'Invitation is no longer pending'; END IF;
  IF v_inv.expires_at <= now() THEN
    UPDATE public.trip_invitations SET status='expired' WHERE id=v_inv.id;
    RETURN NULL;
  END IF;
  IF v_inv.invited_email IS NOT NULL AND v_inv.invited_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_inv.ride_id;
  SELECT EXISTS (
    SELECT 1 FROM public.ride_participants WHERE ride_id = v_ride.id AND user_id = auth.uid() AND is_active = true
  ) INTO v_already_member;

  IF NOT v_already_member AND v_ride.max_participants IS NOT NULL THEN
    PERFORM 1 FROM public.rides WHERE id = v_ride.id FOR UPDATE;
    SELECT count(*) INTO v_current_count FROM public.ride_participants
    WHERE ride_id = v_ride.id AND is_active = true;

    IF v_current_count >= v_ride.max_participants THEN
      RAISE EXCEPTION 'Group ride has reached maximum capacity (% riders)', v_ride.max_participants
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.ride_participants(ride_id, user_id, is_active, role, attendance_status)
  VALUES(v_inv.ride_id, auth.uid(), true, v_inv.assigned_role, 'confirmed')
  ON CONFLICT(ride_id, user_id) DO UPDATE SET is_active=true,
    role=CASE WHEN public.ride_participants.role IN ('captain', 'leader') THEN public.ride_participants.role ELSE EXCLUDED.role END;

  UPDATE public.trip_invitations SET status='accepted', accepted_by=auth.uid(), accepted_at=now()
    WHERE id=v_inv.id;

  RETURN v_inv.ride_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_trip_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_trip_invitation(UUID) TO authenticated;

COMMIT;
