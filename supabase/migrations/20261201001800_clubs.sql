-- F15 club layer: clubs own a roster and recurring rides; a ride can belong
-- to a club; member history comes from existing ride data.
-- Writes go through RPCs. The verified badge has no client write path at all:
-- only the service role (dashboard, SQL editor) can set it.

CREATE TABLE IF NOT EXISTS public.clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](-?[a-z0-9]){2,39}$'),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 60),
  city text CHECK (city IS NULL OR char_length(city) <= 60),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  join_policy text NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open', 'code')),
  join_code text NOT NULL DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  verified boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.club_members (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_club_members_user ON public.club_members (user_id);

CREATE TABLE IF NOT EXISTS public.club_ride_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 60),
  -- Small RRULE subset, e.g. 'FREQ=WEEKLY;BYDAY=SU' or 'FREQ=MONTHLY;BYDAY=1SU' (shared/clubs.ts).
  recurrence_rule text NOT NULL CHECK (recurrence_rule ~ '^FREQ=(WEEKLY|MONTHLY)(;INTERVAL=[1-9])?;BYDAY=(-1|[1-4])?(MO|TU|WE|TH|FR|SA|SU)$'),
  template_ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS club_series_id uuid REFERENCES public.club_ride_series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_rides_club ON public.rides (club_id, start_date) WHERE club_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.club_role(p_club_id uuid, p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.club_members WHERE club_id = p_club_id AND user_id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.club_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_club_admin(p_club_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.club_role(p_club_id, p_user_id) IN ('owner', 'admin'), false);
$$;
REVOKE ALL ON FUNCTION public.is_club_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_admin(uuid, uuid) TO authenticated;

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_ride_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clubs, public.club_members, public.club_ride_series FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.clubs, public.club_members, public.club_ride_series FROM authenticated;

DROP POLICY IF EXISTS "Signed-in riders see clubs" ON public.clubs;
CREATE POLICY "Signed-in riders see clubs" ON public.clubs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Members see their club roster" ON public.club_members;
CREATE POLICY "Members see their club roster" ON public.club_members FOR SELECT TO authenticated
  USING (public.club_role(club_id, auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Members see club series" ON public.club_ride_series;
CREATE POLICY "Members see club series" ON public.club_ride_series FOR SELECT TO authenticated
  USING (public.club_role(club_id, auth.uid()) IS NOT NULL);

-- Join codes are for members only; the column is hidden from the shared select.
REVOKE SELECT (join_code) ON public.clubs FROM authenticated;

-- Belt and braces: even if a write path is added later, riders cannot set the badge.
CREATE OR REPLACE FUNCTION public.clubs_guard_verified()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (TG_OP = 'INSERT' AND NEW.verified OR TG_OP = 'UPDATE' AND NEW.verified IS DISTINCT FROM OLD.verified) THEN
    RAISE EXCEPTION 'Only RideNTrack can verify a club' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clubs_guard_verified ON public.clubs;
CREATE TRIGGER trg_clubs_guard_verified BEFORE INSERT OR UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.clubs_guard_verified();

CREATE OR REPLACE FUNCTION public.create_club(p_name text, p_slug text, p_city text, p_description text, p_join_policy text DEFAULT 'open')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_slug text := lower(trim(p_slug));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT public.flag_enabled('clubs') THEN RAISE EXCEPTION 'Clubs are not available yet' USING ERRCODE = '42501'; END IF;
  IF v_slug !~ '^[a-z0-9](-?[a-z0-9]){2,39}$' THEN
    RAISE EXCEPTION 'Use 3 to 40 lowercase letters, numbers and single dashes for the club link' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.club_members WHERE user_id = auth.uid() AND role = 'owner') >= 3 THEN
    RAISE EXCEPTION 'You can own up to three clubs' USING ERRCODE = '23514';
  END IF;
  BEGIN
    INSERT INTO public.clubs (slug, name, city, description, join_policy, created_by)
    VALUES (v_slug, trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_description), ''),
            CASE WHEN p_join_policy = 'code' THEN 'code' ELSE 'open' END, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That club link is taken. Try another.' USING ERRCODE = '23505';
  END;
  INSERT INTO public.club_members (club_id, user_id, role) VALUES (v_id, auth.uid(), 'owner');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_club(p_club_id uuid, p_name text, p_city text, p_description text, p_join_policy text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_club_admin(p_club_id, auth.uid()) THEN RAISE EXCEPTION 'Only club admins can edit the club' USING ERRCODE = '42501'; END IF;
  UPDATE public.clubs SET name = trim(p_name), city = nullif(trim(p_city), ''), description = nullif(trim(p_description), ''),
         join_policy = CASE WHEN p_join_policy = 'code' THEN 'code' ELSE 'open' END
   WHERE id = p_club_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_club(p_slug text, p_code text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clubs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO c FROM public.clubs WHERE slug = lower(trim(p_slug));
  IF NOT FOUND THEN RAISE EXCEPTION 'Club not found' USING ERRCODE = 'P0002'; END IF;
  IF c.join_policy = 'code' AND upper(coalesce(trim(p_code), '')) <> c.join_code THEN
    RAISE EXCEPTION 'Ask a club admin for the join code' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.club_members (club_id, user_id) VALUES (c.id, auth.uid()) ON CONFLICT DO NOTHING;
  RETURN c.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_club_join_code(p_club_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_club_admin(p_club_id, auth.uid()) THEN RAISE EXCEPTION 'Only club admins see the join code' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT join_code FROM public.clubs WHERE id = p_club_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_club(p_club_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.club_role(p_club_id, auth.uid()) = 'owner'
     AND (SELECT count(*) FROM public.club_members WHERE club_id = p_club_id AND role = 'owner') = 1 THEN
    RAISE EXCEPTION 'Make someone else an owner before you leave' USING ERRCODE = '23514';
  END IF;
  DELETE FROM public.club_members WHERE club_id = p_club_id AND user_id = auth.uid();
END;
$$;

-- Owners manage admins and owners; admins can only remove plain members.
CREATE OR REPLACE FUNCTION public.set_club_member_role(p_club_id uuid, p_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me text := public.club_role(p_club_id, auth.uid()); v_them text := public.club_role(p_club_id, p_user_id);
BEGIN
  IF v_them IS NULL THEN RAISE EXCEPTION 'Not a member of this club' USING ERRCODE = 'P0002'; END IF;
  IF p_role NOT IN ('owner', 'admin', 'member', 'removed') THEN RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023'; END IF;
  IF NOT (v_me = 'owner' OR (v_me = 'admin' AND v_them = 'member' AND p_role = 'removed')) THEN
    RAISE EXCEPTION 'Only the club owner can change roles' USING ERRCODE = '42501';
  END IF;
  IF v_them = 'owner' AND p_role <> 'owner'
     AND (SELECT count(*) FROM public.club_members WHERE club_id = p_club_id AND role = 'owner') = 1 THEN
    RAISE EXCEPTION 'A club needs at least one owner' USING ERRCODE = '23514';
  END IF;
  IF p_role = 'removed' THEN
    DELETE FROM public.club_members WHERE club_id = p_club_id AND user_id = p_user_id;
  ELSE
    UPDATE public.club_members SET role = p_role WHERE club_id = p_club_id AND user_id = p_user_id;
  END IF;
END;
$$;

-- A ride joins a club when its captain is also a club admin.
CREATE OR REPLACE FUNCTION public.set_ride_club(p_ride_id uuid, p_club_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_ride_leadership(p_ride_id, auth.uid()) THEN RAISE EXCEPTION 'Only the ride captain can do this' USING ERRCODE = '42501'; END IF;
  IF p_club_id IS NOT NULL AND NOT public.is_club_admin(p_club_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only club admins can add rides to the club' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rides SET club_id = p_club_id, club_series_id = CASE WHEN p_club_id IS NULL THEN NULL ELSE club_series_id END
   WHERE id = p_ride_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_club_series(p_club_id uuid, p_name text, p_rule text, p_template_ride_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_club_admin(p_club_id, auth.uid()) THEN RAISE EXCEPTION 'Only club admins can create a series' USING ERRCODE = '42501'; END IF;
  IF p_template_ride_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rides WHERE id = p_template_ride_id AND club_id = p_club_id) THEN
    RAISE EXCEPTION 'Pick one of this club''s rides as the template' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.club_ride_series (club_id, name, recurrence_rule, template_ride_id, created_by)
  VALUES (p_club_id, trim(p_name), upper(trim(p_rule)), p_template_ride_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Plan the next ride of a series: a copy of the template on that date, in the club.
CREATE OR REPLACE FUNCTION public.schedule_series_ride(p_series_id uuid, p_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.club_ride_series%ROWTYPE; v_ride uuid;
BEGIN
  SELECT * INTO s FROM public.club_ride_series WHERE id = p_series_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Series not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_club_admin(s.club_id, auth.uid()) THEN RAISE EXCEPTION 'Only club admins can schedule rides' USING ERRCODE = '42501'; END IF;
  IF s.template_ride_id IS NULL THEN RAISE EXCEPTION 'This series has no template ride' USING ERRCODE = '22023'; END IF;
  IF p_date < current_date THEN RAISE EXCEPTION 'Pick a date from today on' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.rides WHERE club_series_id = s.id AND start_date = p_date) THEN
    RAISE EXCEPTION 'That date is already planned' USING ERRCODE = '23505';
  END IF;
  v_ride := public.duplicate_trip(s.template_ride_id, s.name || ' · ' || to_char(p_date, 'DD Mon'), p_date);
  -- A copy starts private; a series ride keeps the template's visibility so a public club ride stays public.
  UPDATE public.rides SET club_id = s.club_id, club_series_id = s.id, start_date = coalesce(start_date, p_date),
         visibility = (SELECT visibility FROM public.rides WHERE id = s.template_ride_id)
   WHERE id = v_ride;
  RETURN v_ride;
END;
$$;

-- Club screen for signed-in riders. Members see the roster with each rider's club history.
CREATE OR REPLACE FUNCTION public.get_club(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clubs%ROWTYPE; v_role text; v_members jsonb := '[]'::jsonb; v_series jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO c FROM public.clubs WHERE slug = lower(trim(p_slug));
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_role := public.club_role(c.id, auth.uid());
  IF v_role IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'display_name', coalesce(p.display_name, p.username, 'Rider'), 'role', m.role, 'joined_at', m.joined_at,
             'rides', coalesce(h.rides, 0), 'km', coalesce(h.km, 0), 'last_ride_at', h.last_ride_at)
           ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, coalesce(h.rides, 0) DESC, m.joined_at), '[]'::jsonb)
      INTO v_members
      FROM public.club_members m
      JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS rides,
               round(coalesce(sum(r.estimated_distance_meters), 0) / 1000.0)::integer AS km,
               max(coalesce(r.ended_at, r.start_date::timestamptz)) AS last_ride_at
          FROM public.rides r
         WHERE r.club_id = c.id AND r.status = 'completed'
           AND (r.admin_id = m.user_id OR EXISTS (SELECT 1 FROM public.ride_participants rp WHERE rp.ride_id = r.id AND rp.user_id = m.user_id))
      ) h ON true
     WHERE m.club_id = c.id;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'recurrence_rule', s.recurrence_rule,
             'template_ride_id', s.template_ride_id,
             'planned_dates', (SELECT coalesce(jsonb_agg(r.start_date ORDER BY r.start_date), '[]'::jsonb) FROM public.rides r
                                WHERE r.club_series_id = s.id AND r.start_date >= current_date))
           ORDER BY s.created_at), '[]'::jsonb)
      INTO v_series FROM public.club_ride_series s WHERE s.club_id = c.id AND s.active;
  END IF;
  RETURN jsonb_build_object(
    'club', jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'city', c.city, 'description', c.description,
                               'join_policy', c.join_policy, 'verified', c.verified, 'created_at', c.created_at),
    'my_role', v_role,
    'member_count', (SELECT count(*) FROM public.club_members WHERE club_id = c.id),
    'members', v_members,
    'series', v_series,
    'rides', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'start_date', r.start_date,
                'distance_km', round(coalesce(r.estimated_distance_meters, 0) / 1000.0), 'visibility', r.visibility)
              ORDER BY r.start_date DESC NULLS LAST), '[]'::jsonb)
              FROM (SELECT * FROM public.rides r WHERE r.club_id = c.id
                      AND (v_role IS NOT NULL OR r.visibility = 'public')
                    ORDER BY r.start_date DESC NULLS LAST LIMIT 30) r)
  );
END;
$$;

-- Public club page (web/src/app/club/[slug]): no member names, only public rides.
CREATE OR REPLACE FUNCTION public.get_public_club(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN c.id IS NULL OR NOT public.flag_enabled('clubs') THEN NULL ELSE jsonb_build_object(
    'slug', c.slug, 'name', c.name, 'city', c.city, 'description', c.description, 'verified', c.verified,
    'join_policy', c.join_policy, 'since', c.created_at,
    'member_count', (SELECT count(*) FROM public.club_members WHERE club_id = c.id),
    'completed_rides', (SELECT count(*) FROM public.rides WHERE club_id = c.id AND status = 'completed'),
    'total_km', (SELECT round(coalesce(sum(estimated_distance_meters), 0) / 1000.0) FROM public.rides WHERE club_id = c.id AND status = 'completed'),
    'upcoming', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'start_date', r.start_date,
                   'origin', r.origin, 'destination', r.destination, 'distance_km', round(coalesce(r.estimated_distance_meters, 0) / 1000.0))
                   ORDER BY r.start_date), '[]'::jsonb)
                 FROM public.rides r WHERE r.club_id = c.id AND r.visibility = 'public' AND r.status = 'planned'
                   AND (r.start_date IS NULL OR r.start_date >= current_date))
  ) END
  FROM (SELECT 1) one LEFT JOIN public.clubs c ON c.slug = lower(trim(p_slug));
$$;

CREATE OR REPLACE FUNCTION public.get_my_clubs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'city', c.city, 'verified', c.verified,
           'role', m.role, 'member_count', (SELECT count(*) FROM public.club_members x WHERE x.club_id = c.id),
           'next_ride', (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'start_date', r.start_date) FROM public.rides r
                          WHERE r.club_id = c.id AND r.status IN ('planned', 'active') ORDER BY r.start_date NULLS LAST LIMIT 1))
         ORDER BY m.joined_at), '[]'::jsonb)
    FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
   WHERE m.user_id = auth.uid();
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_club(text,text,text,text,text)', 'public.update_club(uuid,text,text,text,text)', 'public.join_club(text,text)',
    'public.get_club_join_code(uuid)', 'public.leave_club(uuid)', 'public.set_club_member_role(uuid,uuid,text)',
    'public.set_ride_club(uuid,uuid)', 'public.create_club_series(uuid,text,text,uuid)', 'public.schedule_series_ride(uuid,date)',
    'public.get_club(text)', 'public.get_my_clubs()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_public_club(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_club(text) TO anon, authenticated;
