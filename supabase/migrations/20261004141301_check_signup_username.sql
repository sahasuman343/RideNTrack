BEGIN;

-- A signup preflight exposes only handle availability, never profile rows or IDs.
-- The profiles username unique constraint still resolves concurrent signups.
CREATE OR REPLACE FUNCTION public.is_username_available(requested_username text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT requested_username IS NOT NULL
    AND char_length(btrim(requested_username)) BETWEEN 1 AND 64
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE username = btrim(requested_username)
    );
$$;

REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated;
COMMENT ON FUNCTION public.is_username_available(text) IS
  'Public signup preflight: returns only whether the exact trimmed username can be used. Does not reserve it.';

COMMIT;
