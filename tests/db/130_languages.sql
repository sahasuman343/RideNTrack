\set ON_ERROR_STOP on
-- F13: a family contact's language reaches the outbound payload.
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1300000-0000-4000-8000-000000000001', 'lang1@example.test', '{"username":"lang_captain","display_name":"Lang Captain"}'),
  ('f1300000-0000-4000-8000-000000000002', 'lang2@example.test', '{"username":"lang_other","display_name":"Lang Other"}')
ON CONFLICT (id) DO NOTHING;
SET ROLE authenticated;
DO $$
DECLARE v_ride uuid; v_amma uuid; v_appa uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1300000-0000-4000-8000-000000000001', true);
  v_ride := public.create_trip_plan(
    '{"name":"Language fixture","trip_type":"group","visibility":"invite_only","origin":"A","destination":"B","origin_coords":[77,12],"destination_coords":[78,13]}'::jsonb,
    '[{"sequence":0,"waypoint_type":"origin","name":"A","latitude":12,"longitude":77},{"sequence":1,"waypoint_type":"destination","name":"B","latitude":13,"longitude":78}]'::jsonb,
    '[]'::jsonb, NULL);
  v_amma := public.save_family_contact(NULL, 'Amma', '+919811111111', 'Mother');
  v_appa := public.save_family_contact(NULL, 'Appa', '+919811111112', NULL);
  IF (SELECT language FROM public.family_contacts WHERE id = v_amma) <> 'en' THEN RAISE EXCEPTION 'default language should be en'; END IF;
  PERFORM public.set_family_contact_language(v_amma, 'hi');
  BEGIN
    PERFORM public.set_family_contact_language(v_amma, 'fr');
    RAISE EXCEPTION 'unsupported language accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'f1300000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.set_family_contact_language(v_appa, 'hi');
    RAISE EXCEPTION 'another rider changed my contact';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub', 'f1300000-0000-4000-8000-000000000001', true);
  PERFORM public.start_ride(v_ride, 'fixture');
  RESET ROLE;
  IF (SELECT payload->>'lang' FROM public.outbound_messages WHERE ride_id = v_ride AND recipient = '+919811111111' AND template = 'family_ride_started') <> 'hi' THEN
    RAISE EXCEPTION 'Hindi contact payload missing lang=hi';
  END IF;
  IF (SELECT payload->>'lang' FROM public.outbound_messages WHERE ride_id = v_ride AND recipient = '+919811111112' AND template = 'family_ride_started') <> 'en' THEN
    RAISE EXCEPTION 'English contact payload missing lang=en';
  END IF;
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'f1300000-0000-4000-8000-000000000001', true);
  PERFORM public.end_ride(v_ride);
  PERFORM public.delete_trip(v_ride);
END $$;
RESET ROLE;
