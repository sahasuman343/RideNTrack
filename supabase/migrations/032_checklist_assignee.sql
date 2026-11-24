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

CREATE OR REPLACE FUNCTION public.get_trip_checklists(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res jsonb;
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
      'assigned_to_user_id', c.assigned_to_user_id,
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

REVOKE EXECUTE ON FUNCTION public.get_trip_checklists(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_checklists(uuid) TO authenticated;

COMMIT;
