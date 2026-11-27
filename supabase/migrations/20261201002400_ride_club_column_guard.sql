-- Guard the club and paid-registration columns on rides.
--
-- The "Admin can update ride" policy lets a ride's captain update any column
-- of their own ride, and the insert policy lets anyone create a ride with any
-- column set. That made the RPC checks easy to skip:
--   * set_ride_club checks the caller is a club admin, but a direct
--     UPDATE rides SET club_id = <any club> worked. The ride then showed on
--     that club's pages and got Pro from the club's plan (ride_has_pro_access).
--   * set_ride_registration checks the paid_registrations flag and refuses to
--     change a fee riders already paid, but a direct UPDATE of
--     registration_fee_paise skipped both.
-- These columns now change only inside the SECURITY DEFINER functions that
-- own them (set_ride_club, schedule_series_ride, set_ride_registration,
-- duplicate_trip), which run as the function owner, not as a client role.
-- Ordinary trip edits from the apps (name, description, visibility, capacity,
-- rules, route) are unaffected.

CREATE OR REPLACE FUNCTION public.rides_guard_managed_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.club_id IS NOT NULL OR NEW.club_series_id IS NOT NULL
       OR NEW.registration_fee_paise IS NOT NULL OR NEW.registration_capacity IS NOT NULL OR NEW.registration_note IS NOT NULL THEN
      RAISE EXCEPTION 'Add the ride to a club or set a fee from the ride settings' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.club_id IS DISTINCT FROM OLD.club_id OR NEW.club_series_id IS DISTINCT FROM OLD.club_series_id THEN
    RAISE EXCEPTION 'Only club admins can add rides to the club' USING ERRCODE = '42501';
  ELSIF NEW.registration_fee_paise IS DISTINCT FROM OLD.registration_fee_paise
     OR NEW.registration_capacity IS DISTINCT FROM OLD.registration_capacity
     OR NEW.registration_note IS DISTINCT FROM OLD.registration_note THEN
    RAISE EXCEPTION 'Set the registration fee from the ride settings' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rides_guard_managed_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rides_guard_managed_columns ON public.rides;
CREATE TRIGGER rides_guard_managed_columns
  BEFORE INSERT OR UPDATE OF club_id, club_series_id, registration_fee_paise, registration_capacity, registration_note
  ON public.rides FOR EACH ROW EXECUTE FUNCTION public.rides_guard_managed_columns();
