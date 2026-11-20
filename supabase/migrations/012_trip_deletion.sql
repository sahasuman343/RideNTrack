-- Allow trip leaders to permanently delete their trip aggregate.
-- Dependent trip records are removed by the existing ON DELETE CASCADE foreign keys.
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_trip(p_ride_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.rides
  WHERE id = p_ride_id
    AND admin_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found or you are not its leader' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_trip(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_trip(UUID) TO authenticated;

COMMIT;
