-- Family links show only their own rider and the captain, and end with the ride.
--
-- Any rider can share a family link (decision 3), so the link must not hand
-- the rest of the group's live positions to someone none of them chose:
--   * kind = 'family': the snapshot lists only the link's rider and the
--     ride's captain. Captain spectator links (kind = 'share') still show
--     the group, as before.
--   * A family link keeps working for the whole live ride, even a multi-day
--     ride longer than the 72 hours it was created with, and stops 6 hours
--     after the ride ends. Only a link that was still valid when this run of
--     the ride started gets that extension, so a restarted ride does not
--     revive links that had already ended.

BEGIN;

-- When a ride is completed or archived, family links that were live for it
-- end 6 hours after the ride ends. That can extend a link whose 72 hours ran
-- out during a long ride; links that had already ended are left alone.
CREATE OR REPLACE FUNCTION public.family_links_end_with_ride()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('completed', 'archived') AND OLD.status IN ('planned', 'active') THEN
    UPDATE public.ride_share_links
       SET expires_at = coalesce(NEW.ended_at, now()) + interval '6 hours'
     WHERE ride_id = NEW.id AND kind = 'family' AND revoked_at IS NULL
       AND (expires_at > now() OR (NEW.started_at IS NOT NULL AND expires_at > NEW.started_at));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.family_links_end_with_ride() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS family_links_end_with_ride ON public.rides;
CREATE TRIGGER family_links_end_with_ride AFTER UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.family_links_end_with_ride();

-- Rides that already ended: apply the same cut to their open family links.
UPDATE public.ride_share_links l
   SET expires_at = least(l.expires_at, coalesce(r.ended_at, now()) + interval '6 hours')
  FROM public.rides r
 WHERE r.id = l.ride_id AND l.kind = 'family' AND l.revoked_at IS NULL
   AND r.status IN ('completed', 'archived');

CREATE OR REPLACE FUNCTION public.get_public_ride_snapshot(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_link record;
  v_ride jsonb;
  v_waypoints jsonb;
  v_stays jsonb;
  v_participants jsonb;
  v_subject jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN RETURN NULL; END IF;
  -- A family link outlives its 72 hours while the ride is still live, if it
  -- was still valid when this run of the ride started.
  SELECT l.ride_id, l.expires_at, l.kind, l.subject_user_id, r.admin_id INTO v_link
    FROM public.ride_share_links l
    JOIN public.rides r ON r.id = l.ride_id
   WHERE l.token = trim(p_token) AND l.revoked_at IS NULL
     AND (l.expires_at > now()
          OR (l.kind = 'family' AND r.status = 'active' AND l.expires_at > r.started_at))
   LIMIT 1;
  IF v_link.ride_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'origin', r.origin, 'destination', r.destination,
           'origin_coords', r.origin_coords, 'destination_coords', r.destination_coords, 'route_geometry', r.route_geometry,
           'started_at', r.started_at, 'ended_at', r.ended_at)
    INTO v_ride FROM public.rides r WHERE r.id = v_link.ride_id;
  IF v_ride IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'waypoint_type', w.waypoint_type, 'latitude', w.latitude,
           'longitude', w.longitude, 'sequence', w.sequence, 'planned_arrival', w.planned_arrival) ORDER BY w.sequence), '[]'::jsonb)
    INTO v_waypoints FROM public.trip_waypoints w WHERE w.ride_id = v_link.ride_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'latitude', s.latitude, 'longitude', s.longitude, 'check_in', s.check_in) ORDER BY s.check_in NULLS LAST), '[]'::jsonb)
    INTO v_stays FROM public.trip_stays s WHERE s.ride_id = v_link.ride_id AND s.latitude IS NOT NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', sub.user_id, 'display_name', sub.display_name, 'lat', sub.lat, 'lng', sub.lng,
           'speed', sub.speed, 'heading', sub.heading, 'timestamp', sub.timestamp)), '[]'::jsonb)
    INTO v_participants
    FROM (
      SELECT DISTINCT ON (rp.user_id) rp.user_id, coalesce(p.display_name, 'Rider') AS display_name,
             lu.lat, lu.lng, lu.speed, lu.heading, lu."timestamp" AS timestamp
        FROM public.ride_participants rp
        JOIN public.profiles p ON p.id = rp.user_id
        LEFT JOIN public.location_updates lu ON lu.ride_id = rp.ride_id AND lu.user_id = rp.user_id
       WHERE rp.ride_id = v_link.ride_id AND rp.is_active AND lu.lat IS NOT NULL AND lu.lng IS NOT NULL
         AND (v_link.kind IS DISTINCT FROM 'family' OR rp.user_id IN (v_link.subject_user_id, v_link.admin_id))
       ORDER BY rp.user_id, lu."timestamp" DESC
    ) sub;

  IF v_link.subject_user_id IS NOT NULL THEN
    SELECT jsonb_build_object('user_id', p.id, 'display_name', coalesce(p.display_name, 'Your rider')) INTO v_subject
      FROM public.profiles p WHERE p.id = v_link.subject_user_id;
  END IF;

  RETURN jsonb_build_object('expires_at', v_link.expires_at, 'kind', v_link.kind, 'subject', v_subject, 'ride', v_ride,
    'waypoints', v_waypoints, 'stays', v_stays, 'participants', v_participants);
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_ride_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_ride_snapshot(text) TO anon, authenticated;

COMMIT;
