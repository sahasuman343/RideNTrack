\set ON_ERROR_STOP on
-- Migration 070: a failure while queuing a family text never rolls back the
-- location fix or the alert that caused it. Runs in a transaction that is
-- rolled back, because it swaps notify_family for one that always fails.
RESET ROLE;
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f2500000-0000-4000-8000-000000000001', 'ff1@example.test', '{"username":"ff_rider","display_name":"FF Rider"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.rides (id, name, ride_code, admin_id, origin, destination, origin_coords, destination_coords, status)
VALUES ('f2500000-0000-4000-8000-0000000000a1', 'Fanout fixture', 'FF2501', 'f2500000-0000-4000-8000-000000000001',
        'A', 'B', '[77,12]', '[78,13]', 'active');
INSERT INTO public.trip_stays (ride_id, name, latitude, longitude)
VALUES ('f2500000-0000-4000-8000-0000000000a1', 'Fanout camp', 12.9, 77.9);
INSERT INTO public.family_contacts (user_id, name, phone) VALUES ('f2500000-0000-4000-8000-000000000001', 'Amma', '+919876500001');

CREATE OR REPLACE FUNCTION public.notify_family(p_ride_id uuid, p_user_id uuid, p_template text, p_vars jsonb, p_event_key text)
RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated fan-out failure'; END; $$;

SET client_min_messages = error;
INSERT INTO public.location_updates (ride_id, user_id, lat, lng)
VALUES ('f2500000-0000-4000-8000-0000000000a1', 'f2500000-0000-4000-8000-000000000001', 12.9, 77.9);
INSERT INTO public.alerts (ride_id, user_id, type, message)
VALUES ('f2500000-0000-4000-8000-0000000000a1', 'f2500000-0000-4000-8000-000000000001', 'check_in_missed', 'No answer');
INSERT INTO public.alerts (ride_id, user_id, type, message)
VALUES ('f2500000-0000-4000-8000-0000000000a1', 'f2500000-0000-4000-8000-000000000001', 'crash_detected', 'Crash');
RESET client_min_messages;

DO $$
DECLARE v_loc int; v_alerts int; v_arrivals int;
BEGIN
  SELECT count(*) INTO v_loc FROM public.location_updates WHERE ride_id = 'f2500000-0000-4000-8000-0000000000a1';
  SELECT count(*) INTO v_alerts FROM public.alerts WHERE ride_id = 'f2500000-0000-4000-8000-0000000000a1';
  SELECT count(*) INTO v_arrivals FROM public.family_stay_arrivals WHERE ride_id = 'f2500000-0000-4000-8000-0000000000a1';
  IF v_loc <> 1 THEN RAISE EXCEPTION 'location fix lost when family text failed (%)', v_loc; END IF;
  IF v_alerts <> 2 THEN RAISE EXCEPTION 'alerts lost when family text failed (%)', v_alerts; END IF;
  IF v_arrivals <> 1 THEN RAISE EXCEPTION 'stay arrival not recorded (%)', v_arrivals; END IF;
END $$;
ROLLBACK;
