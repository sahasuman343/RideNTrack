-- Phase 0 Hardening: Cascading account deletion across all user-owned rows
BEGIN;

ALTER TABLE public.rides
  DROP CONSTRAINT IF EXISTS rides_admin_id_fkey;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.ride_participants
  DROP CONSTRAINT IF EXISTS ride_participants_user_id_fkey;
ALTER TABLE public.ride_participants
  ADD CONSTRAINT ride_participants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.location_updates
  DROP CONSTRAINT IF EXISTS location_updates_user_id_fkey;
ALTER TABLE public.location_updates
  ADD CONSTRAINT location_updates_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_user_id_fkey;
ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.trip_invitations
  DROP CONSTRAINT IF EXISTS trip_invitations_invited_by_fkey;
ALTER TABLE public.trip_invitations
  ADD CONSTRAINT trip_invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.trip_invitations
  DROP CONSTRAINT IF EXISTS trip_invitations_accepted_by_fkey;
ALTER TABLE public.trip_invitations
  ADD CONSTRAINT trip_invitations_accepted_by_fkey
  FOREIGN KEY (accepted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.trip_regroup_points
  DROP CONSTRAINT IF EXISTS trip_regroup_points_created_by_fkey;
ALTER TABLE public.trip_regroup_points
  ADD CONSTRAINT trip_regroup_points_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.trip_regroup_arrivals
  DROP CONSTRAINT IF EXISTS trip_regroup_arrivals_user_id_fkey;
ALTER TABLE public.trip_regroup_arrivals
  ADD CONSTRAINT trip_regroup_arrivals_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- RPC for self-service account deletion
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.profiles WHERE id = v_user_id;

  BEGIN
    DELETE FROM auth.users WHERE id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    -- In environments where auth.users is restricted, profile cascading is complete
    NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

COMMIT;
