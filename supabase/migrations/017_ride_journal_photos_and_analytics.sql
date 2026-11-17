-- Phase 2 Milestone 6: Ride Journal, Photo Attachments, Analytics & Personal Milestones
BEGIN;

CREATE TABLE IF NOT EXISTS public.trip_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT,
  notes TEXT,
  highlights TEXT,
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  photos JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ride_id, user_id)
);

ALTER TABLE public.trip_journal_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trip_journal_entries' AND policyname = 'Journal entries readable by trip participants') THEN
    CREATE POLICY "Journal entries readable by trip participants"
      ON public.trip_journal_entries
      FOR SELECT TO authenticated
      USING (public.is_ride_participant(ride_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trip_journal_entries' AND policyname = 'Users manage their own journal entries') THEN
    CREATE POLICY "Users manage their own journal entries"
      ON public.trip_journal_entries
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_trip_journal_entry(
  p_ride_id UUID,
  p_title TEXT,
  p_notes TEXT,
  p_highlights TEXT DEFAULT NULL,
  p_rating INTEGER DEFAULT NULL,
  p_photos JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
  IF NOT public.is_ride_participant(p_ride_id, auth.uid()) THEN
    RAISE EXCEPTION 'You must be a trip participant to create a journal entry' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.trip_journal_entries(ride_id, user_id, title, notes, highlights, rating, photos, updated_at)
  VALUES (p_ride_id, auth.uid(), trim(p_title), p_notes, p_highlights, p_rating, COALESCE(p_photos, '[]'::jsonb), now())
  ON CONFLICT (ride_id, user_id) DO UPDATE SET
    title = EXCLUDED.title,
    notes = EXCLUDED.notes,
    highlights = EXCLUDED.highlights,
    rating = EXCLUDED.rating,
    photos = EXCLUDED.photos,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_rider_analytics(p_user_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_target_id UUID := COALESCE(p_user_id, auth.uid());
  v_total_distance_km NUMERIC := 0;
  v_total_hours NUMERIC := 0;
  v_completed_trips INTEGER := 0;
  v_active_trips INTEGER := 0;
  v_milestones JSONB := '[]'::jsonb;
BEGIN
  IF v_target_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;

  SELECT
    COALESCE(SUM(r.estimated_distance_meters) / 1000, 0),
    COALESCE(SUM(r.estimated_duration_seconds) / 3600, 0),
    COUNT(*) FILTER (WHERE r.status = 'completed'),
    COUNT(*) FILTER (WHERE r.status = 'active' OR r.status = 'planned')
  INTO v_total_distance_km, v_total_hours, v_completed_trips, v_active_trips
  FROM public.ride_participants rp
  JOIN public.rides r ON r.id = rp.ride_id
  WHERE rp.user_id = v_target_id AND rp.is_active = true;

  -- Compute milestone badges
  IF v_total_distance_km >= 100 THEN
    v_milestones := v_milestones || jsonb_build_object('id', 'century_rider', 'title', 'Century Rider', 'description', '100+ km toured', 'icon', '🥉');
  END IF;
  IF v_total_distance_km >= 500 THEN
    v_milestones := v_milestones || jsonb_build_object('id', 'iron_rider_500', 'title', 'Touring Explorer', 'description', '500+ km toured', 'icon', '🥈');
  END IF;
  IF v_total_distance_km >= 1000 THEN
    v_milestones := v_milestones || jsonb_build_object('id', 'highway_master', 'title', 'Highway Master', 'description', '1,000+ km journeyed', 'icon', '🥇');
  END IF;
  IF v_completed_trips >= 1 THEN
    v_milestones := v_milestones || jsonb_build_object('id', 'first_expedition', 'title', 'First Journey', 'description', 'Completed first motorcycle trip', 'icon', '🏍️');
  END IF;
  IF v_completed_trips >= 5 THEN
    v_milestones := v_milestones || jsonb_build_object('id', 'veteran_tourer', 'title', 'Veteran Tourer', 'description', '5 completed tours', 'icon', '👑');
  END IF;

  RETURN jsonb_build_object(
    'total_distance_km', ROUND(v_total_distance_km, 1),
    'total_hours', ROUND(v_total_hours, 1),
    'completed_trips', v_completed_trips,
    'active_trips', v_active_trips,
    'milestones', v_milestones
  );
END; $$;

REVOKE ALL ON FUNCTION public.save_trip_journal_entry(UUID, TEXT, TEXT, TEXT, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_trip_journal_entry(UUID, TEXT, TEXT, TEXT, INTEGER, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.get_rider_analytics(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rider_analytics(UUID) TO authenticated;

COMMIT;
