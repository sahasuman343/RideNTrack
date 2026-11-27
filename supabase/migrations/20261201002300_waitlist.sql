-- Waitlist for the website. Anyone can join with an email; nobody can read the
-- list through the API. Signup order is kept so the owner can grant the launch
-- offer (first 10 get Pro free for 3 months) by hand. New table only: nothing
-- the mobile app reads changes.

CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_email_shape CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT waitlist_email_lower CHECK (email = lower(email)),
  CONSTRAINT waitlist_name_length CHECK (name IS NULL OR length(name) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_email_key ON public.waitlist_signups (email);

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist_signups FROM anon, authenticated;

-- How many places the launch offer has.
CREATE OR REPLACE FUNCTION public.waitlist_offer_places() RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 10 $$;

-- Joins the waitlist. Returns whether this email is within the first places.
-- Joining twice keeps the first signup.
CREATE OR REPLACE FUNCTION public.join_waitlist(p_email text, p_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_position bigint;
BEGIN
  IF length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 80 THEN
    RAISE EXCEPTION 'Name is too long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.waitlist_signups (email, name) VALUES (v_email, v_name)
  ON CONFLICT (email) DO NOTHING
  RETURNING position INTO v_position;

  IF v_position IS NULL THEN
    SELECT w.position INTO v_position FROM public.waitlist_signups w WHERE w.email = v_email;
  END IF;

  -- Rank among signups, so gaps in the identity sequence don't cost anyone a place.
  RETURN jsonb_build_object(
    'early', (SELECT count(*) FROM public.waitlist_signups w WHERE w.position <= v_position) <= public.waitlist_offer_places()
  );
END;
$$;

-- Places left in the launch offer, for the form. Reveals only a number from 0 to 10.
CREATE OR REPLACE FUNCTION public.waitlist_places_left() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT greatest(0, public.waitlist_offer_places() - (SELECT count(*) FROM public.waitlist_signups))::integer
$$;

REVOKE ALL ON FUNCTION public.join_waitlist(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waitlist_places_left() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_waitlist(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waitlist_places_left() TO anon, authenticated;
