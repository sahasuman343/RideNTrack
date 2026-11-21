-- Phase 2 Milestone: 5-Tier Rider Roles, Leadership Transfer, and Pre-Ride Checklist
BEGIN;

-- 1. Expand role check constraint on ride_participants
ALTER TABLE public.ride_participants
  DROP CONSTRAINT IF EXISTS ride_participants_role_check;

ALTER TABLE public.ride_participants
  ADD CONSTRAINT ride_participants_role_check
  CHECK (role IN ('captain', 'co-captain', 'marshal', 'sweeper', 'member', 'leader', 'sweep', 'rider'));

-- 2. Expand role check constraint on trip_invitations
ALTER TABLE public.trip_invitations
  DROP CONSTRAINT IF EXISTS trip_invitations_assigned_role_check;
ALTER TABLE public.trip_invitations
  DROP CONSTRAINT IF EXISTS trip_invitations_role_check;

ALTER TABLE public.trip_invitations
  ADD CONSTRAINT trip_invitations_assigned_role_check
  CHECK (assigned_role IN ('captain', 'co-captain', 'marshal', 'sweeper', 'member', 'leader', 'sweep', 'rider'));

-- 3. Expand status check constraint on trip_invitations to include 'rejected'
ALTER TABLE public.trip_invitations
  DROP CONSTRAINT IF EXISTS trip_invitations_status_check;

ALTER TABLE public.trip_invitations
  ADD CONSTRAINT trip_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'expired', 'revoked', 'rejected'));

-- 4. Pre-Ride Checklists Table
CREATE TABLE IF NOT EXISTS public.trip_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bike_inspection', 'riding_gear', 'documents', 'emergency_kit', 'fuel_tires')),
  title TEXT NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trip_checklist_completions (
  checklist_id UUID NOT NULL REFERENCES public.trip_checklists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (checklist_id, user_id)
);

ALTER TABLE public.trip_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_checklist_completions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trip_checklists' AND policyname = 'Checklists visible to trip members') THEN
    CREATE POLICY "Checklists visible to trip members"
      ON public.trip_checklists FOR SELECT TO authenticated
      USING (public.is_ride_participant(ride_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trip_checklists' AND policyname = 'Admins manage trip checklists') THEN
    CREATE POLICY "Admins manage trip checklists"
      ON public.trip_checklists FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trip_checklist_completions' AND policyname = 'Completions readable by trip members') THEN
    CREATE POLICY "Completions readable by trip members"
      ON public.trip_checklist_completions FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.trip_checklists c
        WHERE c.id = checklist_id AND public.is_ride_participant(c.ride_id, auth.uid())
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trip_checklist_completions' AND policyname = 'Users manage own completions') THEN
    CREATE POLICY "Users manage own completions"
      ON public.trip_checklist_completions FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 5. Helper to seed default checklists for a ride
CREATE OR REPLACE FUNCTION public.seed_default_trip_checklists(p_ride_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
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

-- 6. RPC: get_trip_checklists
CREATE OR REPLACE FUNCTION public.get_trip_checklists(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_ride_participant(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'You must be a trip participant to view checklists' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'category', c.category,
      'title', c.title,
      'description', c.description,
      'is_mandatory', c.is_mandatory,
      'sequence', c.sequence,
      'my_completed', EXISTS (
        SELECT 1 FROM public.trip_checklist_completions comp
        WHERE comp.checklist_id = c.id AND comp.user_id = auth.uid()
      ),
      'completed_count', (
        SELECT count(*) FROM public.trip_checklist_completions comp
        WHERE comp.checklist_id = c.id
      )
    ) ORDER BY c.sequence
  ) INTO v_res
  FROM public.trip_checklists c
  WHERE c.ride_id = p_ride_id;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

-- 7. RPC: toggle_trip_checklist_item
CREATE OR REPLACE FUNCTION public.toggle_trip_checklist_item(p_checklist_id UUID, p_completed BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ride_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT ride_id INTO v_ride_id FROM public.trip_checklists WHERE id = p_checklist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checklist item not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_ride_participant(v_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'You must be a trip participant to check off items' USING ERRCODE = '42501';
  END IF;

  IF p_completed THEN
    INSERT INTO public.trip_checklist_completions (checklist_id, user_id, completed_at)
    VALUES (p_checklist_id, auth.uid(), now())
    ON CONFLICT (checklist_id, user_id) DO NOTHING;
    RETURN true;
  ELSE
    DELETE FROM public.trip_checklist_completions
    WHERE checklist_id = p_checklist_id AND user_id = auth.uid();
    RETURN false;
  END IF;
END;
$$;

-- 8. RPC: transfer_trip_leadership
CREATE OR REPLACE FUNCTION public.transfer_trip_leadership(p_ride_id UUID, p_new_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the current trip captain can transfer leadership' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ride_participants WHERE ride_id = p_ride_id AND user_id = p_new_admin_id AND is_active = true) THEN
    RAISE EXCEPTION 'The new leader must be an active member of this trip' USING ERRCODE = 'P0002';
  END IF;

  -- Update rides admin_id
  UPDATE public.rides SET admin_id = p_new_admin_id WHERE id = p_ride_id;

  -- Set new leader role to captain
  UPDATE public.ride_participants SET role = 'captain' WHERE ride_id = p_ride_id AND user_id = p_new_admin_id;

  -- Demote former leader to co-captain
  UPDATE public.ride_participants SET role = 'co-captain' WHERE ride_id = p_ride_id AND user_id = auth.uid();
END;
$$;

-- 9. RPC: remove_trip_participant
CREATE OR REPLACE FUNCTION public.remove_trip_participant(p_ride_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = auth.uid()) THEN
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

-- 10. RPC: reject_trip_invitation
CREATE OR REPLACE FUNCTION public.reject_trip_invitation(p_token UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_invite public.trip_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_invite FROM public.trip_invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.trip_invitations
  SET status = 'rejected'
  WHERE token = p_token;

  RETURN true;
END;
$$;

-- 11. RPC: set_trip_participant_role (updated for 5-tier touring roles)
CREATE OR REPLACE FUNCTION public.set_trip_participant_role(
  p_ride_id UUID, p_user_id UUID, p_role TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_role NOT IN ('captain', 'co-captain', 'marshal', 'sweeper', 'member', 'leader', 'sweep', 'rider') THEN
    RAISE EXCEPTION 'Role must be captain, co-captain, marshal, sweeper, member, leader, sweep, or rider' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rides r
    JOIN public.ride_participants rp ON rp.ride_id = r.id
    WHERE r.id = p_ride_id AND r.admin_id = auth.uid() AND rp.user_id = auth.uid()
      AND rp.role IN ('captain', 'leader') AND rp.is_active
  ) THEN
    RAISE EXCEPTION 'Only the trip captain can assign roles' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ride_participants
  SET role = p_role
  WHERE ride_id = p_ride_id AND user_id = p_user_id AND is_active AND user_id <> auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active participant not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- 12. RPC: create_trip_invitation (updated for 5-tier touring roles)
CREATE OR REPLACE FUNCTION public.create_trip_invitation(
  p_ride_id UUID,
  p_email TEXT DEFAULT NULL,
  p_role TEXT DEFAULT 'member',
  p_expires_in_hours INTEGER DEFAULT 72
)
RETURNS TABLE(invitation_id UUID, invitation_token UUID, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_token UUID := gen_random_uuid(); v_expiry TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  IF p_role NOT IN ('captain', 'co-captain', 'marshal', 'sweeper', 'member', 'leader', 'sweep', 'rider') THEN
    RAISE EXCEPTION 'Invalid invitation role' USING ERRCODE='22023';
  END IF;
  IF p_expires_in_hours IS NULL OR p_expires_in_hours < 0 OR p_expires_in_hours > 720 THEN
    RAISE EXCEPTION 'Invitation expiry must be between 0 and 720 hours';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r JOIN public.ride_participants rp ON rp.ride_id=r.id
    WHERE r.id=p_ride_id AND r.admin_id=auth.uid() AND rp.user_id=auth.uid()
      AND rp.is_active AND rp.role IN ('captain', 'leader')
  ) THEN RAISE EXCEPTION 'Only the trip leader can invite riders' USING ERRCODE='42501'; END IF;
  IF p_email IS NOT NULL AND (trim(p_email) = '' OR position('@' in p_email) < 2) THEN
    RAISE EXCEPTION 'A valid invite email is required';
  END IF;
  v_expiry := now() + make_interval(hours => p_expires_in_hours);
  INSERT INTO public.trip_invitations(ride_id,token,invited_email,assigned_role,invited_by,expires_at)
  VALUES (p_ride_id,v_token,lower(trim(p_email)),p_role,auth.uid(),v_expiry);
  RETURN QUERY
  SELECT i.id, i.token, i.expires_at FROM public.trip_invitations i WHERE i.token = v_token;
END;
$$;

-- 13. RPC: accept_trip_invitation (updated to preserve captain role)
CREATE OR REPLACE FUNCTION public.accept_trip_invitation(p_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_inv public.trip_invitations%ROWTYPE; v_email TEXT;
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
  INSERT INTO public.ride_participants(ride_id,user_id,is_active,role)
  VALUES(v_inv.ride_id,auth.uid(),true,v_inv.assigned_role)
  ON CONFLICT(ride_id,user_id) DO UPDATE SET is_active=true,
    role=CASE WHEN public.ride_participants.role IN ('captain', 'leader') THEN public.ride_participants.role ELSE EXCLUDED.role END;
  UPDATE public.trip_invitations SET status='accepted',accepted_by=auth.uid(),accepted_at=now()
    WHERE id=v_inv.id;
  RETURN v_inv.ride_id;
END;
$$;

-- Privileges
REVOKE EXECUTE ON FUNCTION public.seed_default_trip_checklists(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_default_trip_checklists(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_trip_checklists(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_checklists(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.toggle_trip_checklist_item(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_trip_checklist_item(UUID, BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.transfer_trip_leadership(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_trip_leadership(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.remove_trip_participant(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_trip_participant(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_trip_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_trip_invitation(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.set_trip_participant_role(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_trip_participant_role(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.create_trip_invitation(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trip_invitation(UUID, TEXT, TEXT, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_trip_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_trip_invitation(UUID) TO authenticated;

COMMIT;
