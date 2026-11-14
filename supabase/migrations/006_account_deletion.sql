-- RT-003: Make Auth user deletion cascade through all user-owned RideNTrack rows.
-- Deleting a ride organizer also deletes that organizer's ride and its dependent
-- participants, GPS history, and alerts. Deleting a participant preserves the
-- ride and other riders' data while removing this user's rows.
BEGIN;

ALTER TABLE public.rides
  DROP CONSTRAINT IF EXISTS rides_admin_id_fkey;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.ride_participants
  DROP CONSTRAINT IF EXISTS ride_participants_user_id_fkey;
ALTER TABLE public.ride_participants
  ADD CONSTRAINT ride_participants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.location_updates
  DROP CONSTRAINT IF EXISTS location_updates_user_id_fkey;
ALTER TABLE public.location_updates
  ADD CONSTRAINT location_updates_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_user_id_fkey;
ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

COMMIT;
