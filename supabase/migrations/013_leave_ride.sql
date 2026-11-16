-- Allow non-admin participants to leave a group ride safely.
-- Marks the participant as inactive so historical location updates and past trip logs remain intact.
BEGIN;

CREATE OR REPLACE FUNCTION public.leave_ride(p_ride_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rides WHERE id = p_ride_id AND admin_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Trip leaders cannot leave their own trip. Delete or transfer the trip instead.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ride_participants
  SET is_active = false
  WHERE ride_id = p_ride_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a participant in this ride' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_ride(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_ride(UUID) TO authenticated;

COMMIT;
