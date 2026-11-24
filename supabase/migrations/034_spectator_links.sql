-- Migration: Live Family Spectator Web Links (ride_share_links + get_public_ride_snapshot)
BEGIN;

CREATE TABLE IF NOT EXISTS public.ride_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_share_links_ride
  ON public.ride_share_links (ride_id, created_at DESC);

ALTER TABLE public.ride_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ride admin manages pro spectator links" ON public.ride_share_links;
DROP POLICY IF EXISTS "Ride admin views spectator links" ON public.ride_share_links;
CREATE POLICY "Ride admin views spectator links" ON public.ride_share_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

DROP POLICY IF EXISTS "Ride admin creates pro spectator links" ON public.ride_share_links;
CREATE POLICY "Ride admin creates pro spectator links" ON public.ride_share_links
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
    AND public.ride_has_pro_access(ride_id)
  );

DROP POLICY IF EXISTS "Ride admin revokes spectator links" ON public.ride_share_links;
CREATE POLICY "Ride admin revokes spectator links" ON public.ride_share_links
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

DROP POLICY IF EXISTS "Ride admin deletes spectator links" ON public.ride_share_links;
CREATE POLICY "Ride admin deletes spectator links" ON public.ride_share_links
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.get_public_ride_snapshot(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ride_id uuid;
  v_expires_at timestamptz;
  v_ride jsonb;
  v_waypoints jsonb;
  v_participants jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT l.ride_id, l.expires_at
    INTO v_ride_id, v_expires_at
  FROM public.ride_share_links l
  WHERE l.token = trim(p_token)
    AND l.revoked_at IS NULL
    AND l.expires_at > now()
  LIMIT 1;

  IF v_ride_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'status', r.status,
    'origin', r.origin,
    'destination', r.destination,
    'origin_coords', r.origin_coords,
    'destination_coords', r.destination_coords,
    'route_geometry', r.route_geometry
  )
    INTO v_ride
  FROM public.rides r
  WHERE r.id = v_ride_id;

  IF v_ride IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', w.name,
      'waypoint_type', w.waypoint_type,
      'latitude', w.latitude,
      'longitude', w.longitude,
      'sequence', w.sequence
    ) ORDER BY w.sequence ASC
  ), '[]'::jsonb)
    INTO v_waypoints
  FROM public.trip_waypoints w
  WHERE w.ride_id = v_ride_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', sub.user_id,
      'display_name', sub.display_name,
      'lat', sub.lat,
      'lng', sub.lng,
      'speed', sub.speed,
      'heading', sub.heading,
      'timestamp', sub.timestamp
    )
  ), '[]'::jsonb)
    INTO v_participants
  FROM (
    SELECT DISTINCT ON (rp.user_id)
      rp.user_id,
      COALESCE(p.display_name, 'Rider') AS display_name,
      lu.lat,
      lu.lng,
      lu.speed,
      lu.heading,
      lu."timestamp" AS timestamp
    FROM public.ride_participants rp
    JOIN public.profiles p ON p.id = rp.user_id
    LEFT JOIN public.location_updates lu
      ON lu.ride_id = rp.ride_id AND lu.user_id = rp.user_id
    WHERE rp.ride_id = v_ride_id
      AND rp.is_active = true
      AND lu.lat IS NOT NULL
      AND lu.lng IS NOT NULL
    ORDER BY rp.user_id, lu."timestamp" DESC
  ) sub;

  RETURN jsonb_build_object(
    'expires_at', v_expires_at,
    'ride', v_ride,
    'waypoints', v_waypoints,
    'participants', v_participants
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_ride_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_ride_snapshot(text) TO anon, authenticated;

COMMIT;
