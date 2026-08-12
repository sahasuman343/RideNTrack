-- Migration 004: Fix Infinite Recursion in ride_participants RLS Policies
-- =========================================================================

-- 1. Create a SECURITY DEFINER helper function to check ride participation safely without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_ride_participant(p_ride_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ride_participants
    WHERE ride_id = p_ride_id AND user_id = p_user_id
  );
$$;

-- 2. Drop existing policies causing recursion
DROP POLICY IF EXISTS "Participants viewable by ride members" ON public.ride_participants;
DROP POLICY IF EXISTS "Rides viewable by participants" ON public.rides;
DROP POLICY IF EXISTS "Location viewable by ride members" ON public.location_updates;
DROP POLICY IF EXISTS "Alerts viewable by ride members" ON public.alerts;

-- 3. Re-create non-recursive policies using the SECURITY DEFINER function

-- ride_participants policy
CREATE POLICY "Participants viewable by ride members" ON public.ride_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND admin_id = auth.uid())
  );

-- rides policy
CREATE POLICY "Rides viewable by participants" ON public.rides
  FOR SELECT USING (
    admin_id = auth.uid()
    OR public.is_ride_participant(id, auth.uid())
  );

-- location_updates policy
CREATE POLICY "Location viewable by ride members" ON public.location_updates
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_ride_participant(ride_id, auth.uid())
  );

-- alerts policy
CREATE POLICY "Alerts viewable by ride members" ON public.alerts
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_ride_participant(ride_id, auth.uid())
  );
