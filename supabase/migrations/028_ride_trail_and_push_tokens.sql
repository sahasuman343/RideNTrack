BEGIN;

-- Whole-ride trail for the caller. The client previously fetched the oldest
-- 500 raw rows, which truncated long rides and under-reported distance.
-- Distance is summed over every breadcrumb; coordinates are evenly thinned
-- (always keeping the latest point) so the payload stays small.
CREATE OR REPLACE FUNCTION public.get_my_ride_trail(p_ride_id uuid, p_max_points integer DEFAULT 1000)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH pts AS (
    SELECT lu.lat, lu.lng, lu."timestamp" AS ts,
           row_number() OVER w AS n,
           count(*) OVER () AS total,
           lag(lu.lat) OVER w AS plat,
           lag(lu.lng) OVER w AS plng
      FROM public.location_updates lu
     WHERE lu.ride_id = p_ride_id AND lu.user_id = auth.uid()
    WINDOW w AS (ORDER BY lu."timestamp", lu.id)
  ), stride AS (
    SELECT greatest(1, ceil(max(total)::numeric / greatest(2, least(coalesce(p_max_points, 1000), 5000))))::bigint AS k
      FROM pts
  )
  SELECT jsonb_build_object(
    'distance_meters', coalesce(round(sum(
      CASE WHEN plat IS NULL THEN 0
      ELSE 2 * 6371008.8 * asin(least(1, sqrt(
        power(sin(radians(lat - plat) / 2), 2)
        + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lng - plng) / 2), 2))))
      END)::numeric), 0),
    'coordinates', coalesce(jsonb_agg(jsonb_build_array(lng, lat) ORDER BY n)
      FILTER (WHERE (n - 1) % stride.k = 0 OR n = total), '[]'::jsonb),
    'last_timestamp', max(ts))
  FROM pts CROSS JOIN stride;
$$;
REVOKE ALL ON FUNCTION public.get_my_ride_trail(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ride_trail(uuid, integer) TO authenticated;

-- Device push tokens so SOS and safety alerts reach riders whose phone is
-- locked or whose app is backgrounded. Delivery is done by the
-- notify-ride-alert Edge Function (see docs/push-notifications.md).
CREATE TABLE IF NOT EXISTS public.push_tokens (
  token text PRIMARY KEY CHECK (length(token) <= 255 AND token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens(user_id);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own push tokens" ON public.push_tokens;
CREATE POLICY "Read own push tokens" ON public.push_tokens FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.push_tokens FROM anon, authenticated;

-- A device token belongs to whoever is signed in on that device now, so a
-- re-registration from another account takes the token over.
CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to enable notifications' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_tokens (token, user_id, platform, updated_at)
  VALUES (p_token, auth.uid(), p_platform, now())
  ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.register_push_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.push_tokens WHERE token = p_token AND user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.unregister_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated;

COMMIT;
