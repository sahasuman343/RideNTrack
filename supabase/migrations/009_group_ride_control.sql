-- Phase 2 foundation: secure invitations and participant command roles.
BEGIN;

ALTER TABLE public.ride_participants
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'rider'
    CHECK (role IN ('leader','sweep','rider'));
UPDATE public.ride_participants rp
SET role = 'leader'
FROM public.rides r
WHERE r.id = rp.ride_id AND r.admin_id = rp.user_id;

CREATE OR REPLACE FUNCTION public.auto_join_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.ride_participants (ride_id,user_id,role)
  VALUES (NEW.id,NEW.admin_id,'leader');
  RETURN NEW;
END; $$;

CREATE UNIQUE INDEX IF NOT EXISTS ride_one_leader_per_trip
  ON public.ride_participants(ride_id) WHERE role = 'leader';

CREATE TABLE IF NOT EXISTS public.trip_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  invited_email TEXT,
  assigned_role TEXT NOT NULL DEFAULT 'rider' CHECK (assigned_role IN ('sweep','rider')),
  invited_by UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID REFERENCES public.profiles(id),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (invited_email IS NULL OR invited_email = lower(trim(invited_email)))
);
CREATE INDEX IF NOT EXISTS trip_invitations_ride_status
  ON public.trip_invitations(ride_id,status,expires_at DESC);

ALTER TABLE public.trip_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trip leaders view invitations" ON public.trip_invitations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_id AND r.admin_id = auth.uid()
  ));
CREATE POLICY "Trip leaders manage invitations" ON public.trip_invitations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()));

REVOKE INSERT,UPDATE,DELETE ON public.trip_invitations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.trip_invitations TO authenticated;

CREATE OR REPLACE FUNCTION public.create_trip_invitation(
  p_ride_id UUID,
  p_email TEXT DEFAULT NULL,
  p_role TEXT DEFAULT 'rider',
  p_expires_in_hours INTEGER DEFAULT 72
)
RETURNS TABLE(invitation_id UUID, invitation_token UUID, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_token UUID := gen_random_uuid(); v_expiry TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  IF p_role NOT IN ('sweep','rider') THEN RAISE EXCEPTION 'Invitation role must be sweep or rider'; END IF;
  IF p_expires_in_hours IS NULL OR p_expires_in_hours < 0 OR p_expires_in_hours > 720 THEN
    RAISE EXCEPTION 'Invitation expiry must be between 0 and 720 hours';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r JOIN public.ride_participants rp ON rp.ride_id=r.id
    WHERE r.id=p_ride_id AND r.admin_id=auth.uid() AND rp.user_id=auth.uid()
      AND rp.is_active AND rp.role='leader'
  ) THEN RAISE EXCEPTION 'Only the trip leader can invite riders' USING ERRCODE='42501'; END IF;
  IF p_email IS NOT NULL AND (trim(p_email) = '' OR position('@' in p_email) < 2) THEN
    RAISE EXCEPTION 'A valid invite email is required';
  END IF;
  v_expiry := now() + make_interval(hours => p_expires_in_hours);
  INSERT INTO public.trip_invitations(ride_id,token,invited_email,assigned_role,invited_by,expires_at)
  VALUES(p_ride_id,v_token,CASE WHEN p_email IS NULL THEN NULL ELSE lower(trim(p_email)) END,p_role,auth.uid(),v_expiry)
  RETURNING id, trip_invitations.token, trip_invitations.expires_at
  INTO invitation_id, invitation_token, expires_at;
  RETURN NEXT;
END; $$;

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
  ON CONFLICT(ride_id,user_id) DO UPDATE SET is_active=true, role=EXCLUDED.role;
  UPDATE public.trip_invitations SET status='accepted',accepted_by=auth.uid(),accepted_at=now()
    WHERE id=v_inv.id;
  RETURN v_inv.ride_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_trip_participant_role(
  p_ride_id UUID,p_user_id UUID,p_role TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  IF p_role NOT IN ('sweep','rider') THEN RAISE EXCEPTION 'Role must be sweep or rider'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rides r JOIN public.ride_participants rp ON rp.ride_id=r.id
    WHERE r.id=p_ride_id AND r.admin_id=auth.uid() AND rp.user_id=auth.uid()
      AND rp.role='leader' AND rp.is_active
  ) THEN RAISE EXCEPTION 'Only the trip leader can assign roles' USING ERRCODE='42501'; END IF;
  UPDATE public.ride_participants SET role=p_role
  WHERE ride_id=p_ride_id AND user_id=p_user_id AND is_active AND user_id <> auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Active participant not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.get_trip_roster(p_ride_id UUID)
RETURNS TABLE(user_id UUID,display_name TEXT,role TEXT,is_active BOOLEAN,last_seen TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT rp.user_id,p.display_name,rp.role,rp.is_active,latest.timestamp
  FROM public.ride_participants rp
  JOIN public.profiles p ON p.id=rp.user_id
  LEFT JOIN LATERAL (
    SELECT l.timestamp FROM public.location_updates l
    WHERE l.ride_id=rp.ride_id AND l.user_id=rp.user_id
    ORDER BY l.timestamp DESC LIMIT 1
  ) latest ON true
  WHERE rp.ride_id=p_ride_id AND rp.is_active
    AND public.is_ride_participant(p_ride_id,auth.uid())
  ORDER BY CASE rp.role WHEN 'leader' THEN 0 WHEN 'sweep' THEN 1 ELSE 2 END,p.display_name;
$$;

REVOKE ALL ON FUNCTION public.create_trip_invitation(UUID,TEXT,TEXT,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_trip_invitation(UUID,TEXT,TEXT,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_trip_invitation(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_trip_invitation(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_trip_participant_role(UUID,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_trip_participant_role(UUID,UUID,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_trip_roster(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_trip_roster(UUID) TO authenticated;

COMMIT;
