-- Club founders can delete their account.
--
-- clubs.created_by and club_ride_series.created_by referenced auth.users with
-- ON DELETE RESTRICT, so delete_user_account failed for anyone who had started
-- a club or a regular ride. The column only records who made the row; roles
-- live in club_members. Keep the club and clear the reference instead.
--
-- join_club now also checks the clubs flag, as create_club already does.
-- Nothing the apps read changes: no RPC returns created_by.

BEGIN;

ALTER TABLE public.clubs ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_created_by_fkey;
ALTER TABLE public.clubs
  ADD CONSTRAINT clubs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.club_ride_series ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.club_ride_series DROP CONSTRAINT IF EXISTS club_ride_series_created_by_fkey;
ALTER TABLE public.club_ride_series
  ADD CONSTRAINT club_ride_series_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.join_club(p_slug text, p_code text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clubs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT public.flag_enabled('clubs') THEN RAISE EXCEPTION 'Clubs are not available yet' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.clubs WHERE slug = lower(trim(p_slug));
  IF NOT FOUND THEN RAISE EXCEPTION 'Club not found' USING ERRCODE = 'P0002'; END IF;
  IF c.join_policy = 'code' AND upper(coalesce(trim(p_code), '')) <> c.join_code THEN
    RAISE EXCEPTION 'Ask a club admin for the join code' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.club_members (club_id, user_id) VALUES (c.id, auth.uid()) ON CONFLICT DO NOTHING;
  RETURN c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.join_club(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_club(text, text) TO authenticated;

COMMIT;
