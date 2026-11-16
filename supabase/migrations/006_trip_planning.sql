-- Trip planning foundation: keep rides as the parent entity for backwards compatibility.
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS trip_type TEXT NOT NULL DEFAULT 'group'
    CHECK (trip_type IN ('solo','group','weekend','touring','expedition')),
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'invite_only'
    CHECK (visibility IN ('private','invite_only','public')),
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS estimated_distance_meters INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_duration_seconds INTEGER;

CREATE TABLE IF NOT EXISTS public.trip_waypoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  waypoint_type TEXT NOT NULL CHECK (waypoint_type IN ('origin','meetup','stop','fuel','food','rest','sightseeing','destination')),
  name TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  provider_place_id TEXT,
  notes TEXT,
  is_optional BOOLEAN NOT NULL DEFAULT false,
  planned_arrival TIMESTAMPTZ,
  planned_departure TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_trip_waypoints_ride_sequence ON public.trip_waypoints(ride_id, sequence);

CREATE TABLE IF NOT EXISTS public.trip_days (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL CHECK (day_number > 0),
  trip_date DATE,
  title TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, id),
  UNIQUE (ride_id, day_number)
);

CREATE TABLE IF NOT EXISTS public.trip_stays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  trip_day_id UUID,
  FOREIGN KEY (ride_id, trip_day_id) REFERENCES public.trip_days(ride_id, id)
    ON DELETE SET NULL (trip_day_id),
  name TEXT NOT NULL,
  stay_type TEXT NOT NULL DEFAULT 'hotel' CHECK (stay_type IN ('hotel','homestay','hostel','camping','guesthouse','other')),
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  provider_place_id TEXT,
  check_in DATE,
  check_out DATE,
  booking_reference TEXT,
  price_amount NUMERIC(12,2),
  price_currency TEXT NOT NULL DEFAULT 'INR',
  contact_phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS idx_trip_stays_ride ON public.trip_stays(ride_id);

ALTER TABLE public.trip_waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_stays ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Trip waypoints visible to ride members" ON public.trip_waypoints
    FOR SELECT USING (public.is_ride_participant(ride_id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Ride admins manage trip waypoints" ON public.trip_waypoints
    FOR ALL USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Trip days visible to ride members" ON public.trip_days
    FOR SELECT USING (public.is_ride_participant(ride_id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Ride admins manage trip days" ON public.trip_days
    FOR ALL USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Trip stays visible to ride members" ON public.trip_stays
    FOR SELECT USING (public.is_ride_participant(ride_id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Ride admins manage trip stays" ON public.trip_stays
    FOR ALL USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
