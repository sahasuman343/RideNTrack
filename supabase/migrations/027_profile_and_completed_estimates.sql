BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blood_group text
  CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

-- Legacy inconsistent fuel settings must not prevent edits to emergency contacts.
CREATE FUNCTION public.check_motorcycle_reserve() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.fuel_reserve_liters >= NEW.fuel_tank_capacity_liters THEN
    RAISE EXCEPTION 'Reserve must be less than tank capacity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_motorcycle_reserve() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER check_motorcycle_reserve BEFORE INSERT OR UPDATE OF
  fuel_tank_capacity_liters, fuel_reserve_liters ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_motorcycle_reserve();

-- Distances are route estimates, not measured GPS mileage.
CREATE OR REPLACE FUNCTION public.get_rider_analytics(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  km numeric;
  hours numeric;
  completed integer;
  active integer;
  badges jsonb;
BEGIN
  IF auth.uid() IS NULL OR (p_user_id IS NOT NULL AND p_user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Only your own rider statistics are available' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(sum(r.estimated_distance_meters) FILTER (WHERE r.status = 'completed'), 0) / 1000.0,
         coalesce(sum(r.estimated_duration_seconds) FILTER (WHERE r.status = 'completed'), 0) / 3600.0,
         count(*) FILTER (WHERE r.status = 'completed'),
         count(*) FILTER (WHERE r.status IN ('planned', 'active'))
    INTO km, hours, completed, active
    FROM public.ride_participants rp JOIN public.rides r ON r.id = rp.ride_id
   WHERE rp.user_id = auth.uid() AND rp.is_active;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description, 'icon', icon)
                            ORDER BY rank), '[]'::jsonb) INTO badges
    FROM (VALUES
      (1, km >= 100, 'century_rider', 'Century Rider', '100 estimated km on completed trips', '🥉'),
      (2, km >= 500, 'iron_rider_500', 'Touring Explorer', '500 estimated km on completed trips', '🥈'),
      (3, km >= 1000, 'highway_master', 'Highway Master', '1,000 estimated km on completed trips', '🥇'),
      (4, completed >= 1, 'first_expedition', 'First Journey', 'Completed first motorcycle trip', '🏍️'),
      (5, completed >= 5, 'veteran_tourer', 'Veteran Tourer', '5 completed tours', '👑')
    ) AS b(rank, earned, id, title, description, icon) WHERE earned;
  RETURN jsonb_build_object('total_distance_km', round(km, 1), 'total_hours', round(hours, 1),
    'completed_trips', completed, 'active_trips', active, 'milestones', badges);
END $$;

COMMIT;
