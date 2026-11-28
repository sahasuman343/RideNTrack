-- F7 general availability: the numbers behind the go / no-go decision.
-- Service role only (run from the SQL editor or a script with the service key).

CREATE OR REPLACE FUNCTION public.crash_beta_report(p_since timestamptz DEFAULT now() - interval '90 days')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH riders AS (
    SELECT id FROM public.profiles WHERE crash_research_consent_at IS NOT NULL
  ), hours AS (
    -- Hours each consenting rider spent on a started ride, capped at 16 h a ride.
    SELECT coalesce(sum(least(extract(epoch FROM (coalesce(r.ended_at, now()) - r.started_at)) / 3600.0, 16)), 0) AS riding_hours
      FROM public.ride_participants rp
      JOIN riders ON riders.id = rp.user_id
      JOIN public.rides r ON r.id = rp.ride_id
     WHERE r.started_at IS NOT NULL AND r.started_at >= p_since
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'riders', (SELECT count(*) FROM riders),
    'riding_hours', round((SELECT riding_hours FROM hours)::numeric, 1),
    'counts', coalesce((SELECT jsonb_object_agg(kind, n) FROM (
        SELECT kind, count(*) AS n FROM public.crash_telemetry WHERE created_at >= p_since GROUP BY kind) k), '{}'::jsonb),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'peak_g', peak_g, 'speed_before_kmh', speed_before_kmh))
        FROM public.crash_telemetry WHERE created_at >= p_since), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.crash_beta_report(timestamptz) FROM PUBLIC, anon, authenticated;
