-- RideNTrack Database Schema
-- Supabase Migration: Initial Schema

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users profile table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  phone TEXT,
  emergency_contact TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rides table
CREATE TABLE public.rides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  ride_code TEXT UNIQUE NOT NULL,
  admin_id UUID NOT NULL REFERENCES public.profiles(id),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  origin_coords JSONB NOT NULL, -- [lng, lat]
  destination_coords JSONB NOT NULL, -- [lng, lat]
  route_geometry JSONB, -- GeoJSON LineString from Mapbox Directions
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ride participants
CREATE TABLE public.ride_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  is_active BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ride_id, user_id)
);

-- Location history (periodic snapshots, not every broadcast)
CREATE TABLE public.location_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION DEFAULT 0,
  heading DOUBLE PRECISION DEFAULT 0,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Alerts
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  type TEXT NOT NULL CHECK (type IN ('emergency', 'break', 'fuel', 'mechanical')),
  message TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);

-- Function to generate a unique 6-character ride code
CREATE OR REPLACE FUNCTION generate_ride_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I
  code TEXT := '';
  i INTEGER;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    -- Check uniqueness
    IF NOT EXISTS (SELECT 1 FROM public.rides WHERE ride_code = code) THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate ride code on insert
CREATE OR REPLACE FUNCTION set_ride_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ride_code IS NULL OR NEW.ride_code = '' THEN
    NEW.ride_code := generate_ride_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_ride_code
  BEFORE INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION set_ride_code();

-- Auto-add admin as participant when ride is created
CREATE OR REPLACE FUNCTION auto_join_admin()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ride_participants (ride_id, user_id)
  VALUES (NEW.id, NEW.admin_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_join_admin
  AFTER INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION auto_join_admin();

-- Row Level Security Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all profiles, update own
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Helper function to check ride participation without RLS recursion
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

-- Rides: participants can view, anyone authenticated can create
CREATE POLICY "Rides viewable by participants" ON public.rides
  FOR SELECT USING (
    admin_id = auth.uid()
    OR public.is_ride_participant(id, auth.uid())
  );
CREATE POLICY "Authenticated users can create rides" ON public.rides
  FOR INSERT WITH CHECK (auth.uid() = admin_id);
CREATE POLICY "Admin can update ride" ON public.rides
  FOR UPDATE USING (auth.uid() = admin_id);

-- Ride participants: viewable by other participants
CREATE POLICY "Participants viewable by ride members" ON public.ride_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND admin_id = auth.uid())
  );
CREATE POLICY "Users can join rides" ON public.ride_participants
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can leave rides" ON public.ride_participants
  FOR DELETE USING (auth.uid() = user_id);

-- Location updates: viewable by ride participants
CREATE POLICY "Location viewable by ride members" ON public.location_updates
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_ride_participant(ride_id, auth.uid())
  );
CREATE POLICY "Users can insert own location" ON public.location_updates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Alerts: viewable by ride participants
CREATE POLICY "Alerts viewable by ride members" ON public.alerts
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_ride_participant(ride_id, auth.uid())
  );
CREATE POLICY "Participants can create alerts" ON public.alerts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_rides_code ON public.rides(ride_code);
CREATE INDEX idx_rides_admin ON public.rides(admin_id);
CREATE INDEX idx_ride_participants_ride ON public.ride_participants(ride_id);
CREATE INDEX idx_ride_participants_user ON public.ride_participants(user_id);
CREATE INDEX idx_location_updates_ride ON public.location_updates(ride_id, timestamp DESC);
CREATE INDEX idx_alerts_ride ON public.alerts(ride_id, created_at DESC);

-- Function to join a ride by code
CREATE OR REPLACE FUNCTION join_ride_by_code(p_code TEXT)
RETURNS UUID AS $$
DECLARE
  v_ride_id UUID;
BEGIN
  SELECT id INTO v_ride_id FROM public.rides WHERE ride_code = UPPER(p_code) AND status != 'completed';
  IF v_ride_id IS NULL THEN
    RAISE EXCEPTION 'Invalid ride code or ride has ended';
  END IF;
  INSERT INTO public.ride_participants (ride_id, user_id)
  VALUES (v_ride_id, auth.uid())
  ON CONFLICT (ride_id, user_id) DO UPDATE SET is_active = true;
  RETURN v_ride_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
