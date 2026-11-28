\set ON_ERROR_STOP on
-- F10: seed present, readable by riders, not writable by them; bbox read capped.
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c8000000-0000-4000-8000-000000000001', true);
  IF (SELECT count(*) FROM public.touring_routes) < 5 THEN RAISE EXCEPTION 'routes not seeded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.route_pois WHERE id = 'fuel-tandi' AND verified_at IS NULL) THEN RAISE EXCEPTION 'seed must start unverified'; END IF;
  IF (SELECT count(*) FROM public.get_route_pois_in_bbox(76.5, 32.0, 78.0, 34.5) WHERE kind = 'fuel') < 3 THEN RAISE EXCEPTION 'bbox read missed Manali–Leh fuel'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_route_pois_in_bbox(60, 5, 100, 40)) THEN RAISE EXCEPTION 'huge bbox not refused'; END IF;
  BEGIN
    INSERT INTO public.route_pois (id, kind, name, lat, lng) VALUES ('fake-pump', 'fuel', 'Fake', 32, 77);
    RAISE EXCEPTION 'rider wrote a POI';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.route_advisories SET body = 'changed' WHERE id = 'rohtang-permit';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.route_advisories WHERE id = 'rohtang-permit' AND body = 'changed') THEN
    RAISE EXCEPTION 'rider changed an advisory';
  END IF;
END $$;
RESET ROLE;
