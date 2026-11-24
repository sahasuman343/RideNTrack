-- Migration: Serialize ride admission lock unconditionally in join_ride_by_code & accept_trip_invitation
BEGIN;

CREATE OR REPLACE FUNCTION public.join_ride_by_code(p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_current_count integer;
  v_already_member boolean;
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

  IF NOT v_already_member THEN
    PERFORM 1 FROM public.rides WHERE id = v_ride.id FOR UPDATE;
    SELECT count(*) INTO v_current_count FROM public.ride_participants
    WHERE ride_id = v_ride.id AND is_active = true;

    IF v_ride.max_participants IS NOT NULL AND v_current_count >= v_ride.max_participants THEN
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

CREATE OR REPLACE FUNCTION public.accept_trip_invitation(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_inv public.trip_invitations%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_email text;
  v_current_count integer;
  v_already_member boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  SELECT * INTO v_inv FROM public.trip_invitations i
    WHERE i.token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'Invitation is no longer pending'; END IF;
  IF v_inv.expires_at <= now() THEN
    UPDATE public.trip_invitations SET status = 'expired' WHERE id = v_inv.id;
    RETURN NULL;
  END IF;
  IF v_inv.invited_email IS NOT NULL AND v_inv.invited_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_inv.ride_id;
  SELECT EXISTS (
    SELECT 1 FROM public.ride_participants WHERE ride_id = v_ride.id AND user_id = auth.uid() AND is_active = true
  ) INTO v_already_member;

  IF NOT v_already_member THEN
    PERFORM 1 FROM public.rides WHERE id = v_ride.id FOR UPDATE;
    SELECT count(*) INTO v_current_count FROM public.ride_participants
    WHERE ride_id = v_ride.id AND is_active = true;

    IF v_ride.max_participants IS NOT NULL AND v_current_count >= v_ride.max_participants THEN
      RAISE EXCEPTION 'Group ride has reached maximum capacity (% riders)', v_ride.max_participants
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.ride_participants(ride_id, user_id, is_active, role, attendance_status)
  VALUES(v_inv.ride_id, auth.uid(), true, v_inv.assigned_role, 'confirmed')
  ON CONFLICT(ride_id, user_id) DO UPDATE SET is_active = true,
    role = CASE WHEN public.ride_participants.role IN ('captain', 'leader') THEN public.ride_participants.role ELSE EXCLUDED.role END;

  UPDATE public.trip_invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
    WHERE id = v_inv.id;

  RETURN v_inv.ride_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_trip_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_trip_invitation(uuid) TO authenticated;

COMMIT;
