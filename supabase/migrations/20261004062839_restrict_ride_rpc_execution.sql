-- Supabase grants client roles EXECUTE directly by default; revoking PUBLIC alone is insufficient.
BEGIN;
REVOKE ALL ON FUNCTION public.is_ride_participant(uuid,uuid), public.get_ride_members(uuid), public.get_latest_ride_locations(uuid), public.join_ride_by_code(text), public.bulk_insert_location_updates(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.auto_join_admin(), public.handle_new_user() FROM PUBLIC, anon, authenticated;
COMMIT;
