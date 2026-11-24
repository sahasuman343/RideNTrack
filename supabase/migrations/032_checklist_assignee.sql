-- Migration: Shared group gear checklist assignee support
BEGIN;

ALTER TABLE public.trip_checklists
  ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.claim_trip_checklist_item(
  p_checklist_id uuid,
  p_assign_to_self boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ride_id uuid;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT ride_id INTO v_ride_id
  FROM public.trip_checklists
  WHERE id = p_checklist_id;

  IF v_ride_id IS NULL THEN
    RAISE EXCEPTION 'Checklist item not found';
  END IF;

  IF NOT (
    public.is_ride_participant(v_ride_id, v_caller)
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = v_ride_id AND r.admin_id = v_caller)
  ) THEN
    RAISE EXCEPTION 'Only ride participants can claim checklist items';
  END IF;

  UPDATE public.trip_checklists
  SET assigned_to_user_id = CASE WHEN p_assign_to_self THEN v_caller ELSE NULL END
  WHERE id = p_checklist_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_trip_checklist_item(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_trip_checklist_item(uuid, boolean) TO authenticated;

COMMIT;
