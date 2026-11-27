-- F12 push-to-talk voice notes. Clips (at most 15 s) live in the private
-- ride-voice bucket at <ride_id>/<user_id>/<client_id>.m4a; a ride_messages
-- row of type 'voice' points at the clip. Decision 3: voice notes are free
-- during a live ride when free_safety_features is on, otherwise they need Pro
-- on the ride (they are chat attachments).
BEGIN;

ALTER TABLE public.ride_messages
  ADD COLUMN IF NOT EXISTS voice_path text,
  ADD COLUMN IF NOT EXISTS voice_duration_ms integer;

ALTER TABLE public.ride_messages DROP CONSTRAINT IF EXISTS ride_messages_message_type_check;
ALTER TABLE public.ride_messages ADD CONSTRAINT ride_messages_message_type_check
  CHECK (message_type IN ('text', 'quick_reply', 'pinned_info', 'system', 'voice'));

ALTER TABLE public.ride_messages DROP CONSTRAINT IF EXISTS ride_messages_voice_check;
ALTER TABLE public.ride_messages ADD CONSTRAINT ride_messages_voice_check CHECK (
  (message_type = 'voice') = (voice_path IS NOT NULL)
  AND (voice_path IS NULL OR (voice_duration_ms BETWEEN 300 AND 15500))
);

-- The clip must sit in this ride's folder under the sender's own id, and voice
-- needs the safety exemption or Pro on the ride.
CREATE OR REPLACE FUNCTION public.check_voice_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.message_type <> 'voice' THEN RETURN NEW; END IF;
  IF NEW.voice_path !~ ('^' || NEW.ride_id::text || '/' || NEW.sender_id::text || '/[0-9a-f-]{36}\.m4a$') THEN
    RAISE EXCEPTION 'Voice clip path does not match this ride and sender' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.flag_enabled('free_safety_features') OR public.ride_has_pro_access(NEW.ride_id)) THEN
    RAISE EXCEPTION 'Voice notes need Pro on this ride' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_voice_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS check_voice_message ON public.ride_messages;
CREATE TRIGGER check_voice_message BEFORE INSERT OR UPDATE OF message_type, voice_path ON public.ride_messages
  FOR EACH ROW EXECUTE FUNCTION public.check_voice_message();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('ride-voice', 'ride-voice', false, 524288, ARRAY['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac'])
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Ride members hear voice notes') THEN
      CREATE POLICY "Ride members hear voice notes" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'ride-voice' AND public.is_ride_participant(((storage.foldername(name))[1])::uuid, auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Ride members record voice notes') THEN
      CREATE POLICY "Ride members record voice notes" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'ride-voice'
          AND (storage.foldername(name))[2] = auth.uid()::text
          AND public.is_ride_participant(((storage.foldername(name))[1])::uuid, auth.uid())
        );
    END IF;
  END IF;
END $$;

COMMIT;
