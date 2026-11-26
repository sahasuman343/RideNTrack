-- Supabase security advisor fixes found on the dev project.
-- 1. Pin search_path on helper and trigger functions (they only use pg_catalog).
ALTER FUNCTION public.distance_m(double precision, double precision, double precision, double precision) SET search_path = '';
ALTER FUNCTION public.public_track_url(text) SET search_path = '';
ALTER FUNCTION public.to_e164(text) SET search_path = '';
ALTER FUNCTION public.stamp_phone_consent() SET search_path = '';
ALTER FUNCTION public.clubs_guard_verified() SET search_path = '';

-- 2. Trigger functions are not RPCs: nobody should be able to call them over the API.
REVOKE EXECUTE ON FUNCTION public.family_on_location() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.family_on_ride_started() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.referral_on_profile_created() FROM PUBLIC, anon, authenticated;
