-- F10 touring knowledge layer: curated routes, POIs and advisories. Read-only
-- for riders; content changes go through migrations (seeded from
-- shared/touringSeed.ts by scripts/touring-seed.cjs) or the service role.
-- verified_at stays NULL until someone checks an item on the ground.
BEGIN;

CREATE TABLE IF NOT EXISTS public.touring_routes (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,60}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  region text NOT NULL DEFAULT '',
  line jsonb NOT NULL CHECK (jsonb_typeof(line) = 'array' AND jsonb_array_length(line) BETWEEN 2 AND 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.route_pois (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,80}$'),
  route_id text REFERENCES public.touring_routes(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('fuel', 'mechanic', 'atm')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  verified_at timestamptz,
  source text,
  note text CHECK (note IS NULL OR length(note) <= 280),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_route_pois_route ON public.route_pois (route_id, kind);
CREATE INDEX IF NOT EXISTS idx_route_pois_lat_lng ON public.route_pois (lat, lng);

CREATE TABLE IF NOT EXISTS public.route_advisories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,80}$'),
  route_id text NOT NULL REFERENCES public.touring_routes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('permit', 'pass_window', 'closure', 'info')),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 80),
  body text NOT NULL CHECK (length(body) BETWEEN 3 AND 400),
  season_from text CHECK (season_from IS NULL OR season_from ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  season_to text CHECK (season_to IS NULL OR season_to ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  url text CHECK (url IS NULL OR url ~ '^https://'),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((season_from IS NULL) = (season_to IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_route_advisories_route ON public.route_advisories (route_id);

ALTER TABLE public.touring_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_pois ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_advisories ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.touring_routes, public.route_pois, public.route_advisories FROM anon, authenticated;

DROP POLICY IF EXISTS "Touring routes are readable" ON public.touring_routes;
CREATE POLICY "Touring routes are readable" ON public.touring_routes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Route POIs are readable" ON public.route_pois;
CREATE POLICY "Route POIs are readable" ON public.route_pois FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Route advisories are readable" ON public.route_advisories;
CREATE POLICY "Route advisories are readable" ON public.route_advisories FOR SELECT TO authenticated USING (true);

-- POIs along any trip (matched to a known route or not), by bounding box.
CREATE OR REPLACE FUNCTION public.get_route_pois_in_bbox(p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision)
RETURNS SETOF public.route_pois LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM public.route_pois
  WHERE lat BETWEEN p_min_lat AND p_max_lat AND lng BETWEEN p_min_lng AND p_max_lng
    AND (p_max_lat - p_min_lat) <= 20 AND (p_max_lng - p_min_lng) <= 20
  ORDER BY kind, name
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.get_route_pois_in_bbox(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_route_pois_in_bbox(double precision, double precision, double precision, double precision) TO authenticated;

-- seed:begin
INSERT INTO public.touring_routes (id, name, region, line) VALUES
  ('manali-leh', 'Manali to Leh', 'Himachal Pradesh, Ladakh', '[[77.1892,32.2432],[77.16,32.316],[77.1235,32.4806],[76.9759,32.5457],[77.0322,32.5713],[77.183,32.643],[77.205,32.672],[77.421,32.759],[77.571,32.919],[77.786,33.143],[77.769,33.507],[77.815,33.828],[77.7356,33.9418],[77.5771,34.1526]]'::jsonb),
  ('srinagar-leh', 'Srinagar to Leh', 'Jammu and Kashmir, Ladakh', '[[74.7973,34.0837],[75.295,34.303],[75.471,34.278],[75.756,34.429],[76.135,34.5539],[76.36,34.381],[76.774,34.283],[76.882,34.32],[77.333,34.191],[77.5771,34.1526]]'::jsonb),
  ('spiti-circuit', 'Shimla to Manali via Spiti', 'Himachal Pradesh', '[[77.1734,31.1048],[77.46,31.256],[77.633,31.45],[78.27,31.539],[78.58,31.76],[78.627,31.881],[78.388,32.092],[78.071,32.227],[77.759,32.438],[77.636,32.396],[77.62,32.36],[77.44,32.33],[77.306,32.375],[77.16,32.316],[77.1892,32.2432]]'::jsonb),
  ('mumbai-goa-nh66', 'Mumbai to Goa on NH66', 'Maharashtra, Goa', '[[73.1175,18.9894],[73.085,18.737],[73.27,18.236],[73.417,18.083],[73.515,17.531],[73.552,17.187],[73.518,16.656],[73.712,16.265],[73.686,16.011],[73.818,15.905],[73.796,15.723],[73.812,15.592],[73.8278,15.4909]]'::jsonb),
  ('bengaluru-ooty', 'Bengaluru to Ooty via Bandipur', 'Karnataka, Tamil Nadu', '[[77.5946,12.9716],[77.28,12.72],[76.895,12.522],[76.6394,12.2958],[76.683,12.117],[76.69,11.81],[76.633,11.667],[76.584,11.57],[76.64,11.57],[76.695,11.4102]]'::jsonb)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region, line = EXCLUDED.line;
INSERT INTO public.route_pois (id, route_id, kind, name, lat, lng, source, note) VALUES
  ('fuel-manali', 'manali-leh', 'fuel', 'Manali fuel stations', 32.24, 77.189, 'seed', NULL),
  ('fuel-tandi', 'manali-leh', 'fuel', 'Tandi fuel station', 32.5457, 76.9759, 'seed', 'Widely known as the last fuel before Karu, over 300 km on.'),
  ('fuel-karu', 'manali-leh', 'fuel', 'Karu fuel station', 33.9418, 77.7356, 'seed', NULL),
  ('fuel-leh', 'manali-leh', 'fuel', 'Leh fuel stations', 34.1526, 77.5771, 'seed', NULL),
  ('fuel-kargil', 'srinagar-leh', 'fuel', 'Kargil fuel stations', 34.5539, 76.135, 'seed', NULL),
  ('fuel-kaza', 'spiti-circuit', 'fuel', 'Kaza fuel station', 32.227, 78.071, 'seed', 'Next fuel towards Manali is at Manali itself.'),
  ('fuel-reckong-peo', 'spiti-circuit', 'fuel', 'Reckong Peo fuel station', 31.539, 78.27, 'seed', NULL)
ON CONFLICT (id) DO UPDATE SET route_id = EXCLUDED.route_id, kind = EXCLUDED.kind, name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, source = EXCLUDED.source, note = EXCLUDED.note;
INSERT INTO public.route_advisories (id, route_id, kind, title, body, season_from, season_to) VALUES
  ('manali-leh-season', 'manali-leh', 'pass_window', 'Manali–Leh highway', 'Usually open from about June to mid-October. Opening dates move with snow clearing, so check before you go.', '06-01', '10-15'),
  ('rohtang-permit', 'manali-leh', 'permit', 'Rohtang Pass permit', 'Riding over Rohtang Pass from Manali needs an online permit from Himachal Pradesh. The Atal Tunnel route does not cross Rohtang.', NULL, NULL),
  ('manali-leh-altitude', 'manali-leh', 'info', 'High passes', 'Baralacha La, Lachulung La and Tanglang La are near or above 5,000 m. Sleep a night at Keylong, Jispa or Sarchu to acclimatise.', NULL, NULL),
  ('zojila-season', 'srinagar-leh', 'pass_window', 'Zoji La', 'Usually open from about May to November, with one-way traffic slots on some days.', '05-01', '11-15'),
  ('ladakh-permit', 'srinagar-leh', 'permit', 'Ladakh side trips', 'Nubra, Pangong and Tso Moriri need a Ladakh permit and environment fee, available online or in Leh.', NULL, NULL),
  ('kunzum-season', 'spiti-circuit', 'pass_window', 'Kunzum La', 'Usually open from about mid-June to mid-October. Outside that, Spiti is reached only from the Kinnaur side.', '06-15', '10-15'),
  ('kinnaur-ilp', 'spiti-circuit', 'permit', 'Inner Line Permit near the border', 'Foreign riders need an Inner Line Permit for the Kinnaur–Spiti border stretch, issued in Reckong Peo, Kaza or Shimla.', NULL, NULL),
  ('konkan-monsoon', 'mumbai-goa-nh66', 'info', 'Monsoon on the Konkan coast', 'Heavy rain from June to September; landslides and road works close stretches of NH66. Ride in daylight.', '06-01', '09-30'),
  ('bandipur-night', 'bengaluru-ooty', 'info', 'Bandipur and Mudumalai at night', 'The forest stretch is closed to traffic from 9 pm to 6 am. Plan to clear it in daylight.', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET route_id = EXCLUDED.route_id, kind = EXCLUDED.kind, title = EXCLUDED.title, body = EXCLUDED.body, season_from = EXCLUDED.season_from, season_to = EXCLUDED.season_to;
-- seed:end

COMMIT;
