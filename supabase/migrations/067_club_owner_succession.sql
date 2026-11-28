-- Audit finding 8: when a club's last owner deletes their account, their
-- club_members row is removed by the cascade and the club was left with no
-- owner, so nobody could manage roles, the join code or the club plan.
-- Promote the longest-standing admin, or failing that the longest-standing
-- member. A club with nobody left keeps its rows and simply has no roster.

CREATE OR REPLACE FUNCTION public.promote_club_owner_on_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next uuid;
BEGIN
  IF OLD.role <> 'owner' THEN RETURN NULL; END IF;
  -- The whole club is being deleted, or another owner remains.
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = OLD.club_id) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.club_members WHERE club_id = OLD.club_id AND role = 'owner') THEN RETURN NULL; END IF;

  SELECT user_id INTO v_next FROM public.club_members
   WHERE club_id = OLD.club_id
   ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at, user_id
   LIMIT 1;
  IF v_next IS NOT NULL THEN
    UPDATE public.club_members SET role = 'owner' WHERE club_id = OLD.club_id AND user_id = v_next;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.promote_club_owner_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS club_owner_succession ON public.club_members;
CREATE TRIGGER club_owner_succession
  AFTER DELETE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.promote_club_owner_on_delete();

-- Clubs already left without an owner get one now.
UPDATE public.club_members m SET role = 'owner'
  FROM (
    SELECT DISTINCT ON (club_id) club_id, user_id
      FROM public.club_members c
     WHERE NOT EXISTS (SELECT 1 FROM public.club_members o WHERE o.club_id = c.club_id AND o.role = 'owner')
     ORDER BY club_id, CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at, user_id
  ) pick
 WHERE m.club_id = pick.club_id AND m.user_id = pick.user_id;
