-- Audit finding 10: voice clips (ride-voice), journal photos (journal_photos)
-- and avatars stayed in Storage after the ride or the account was deleted.
--
-- Supabase Storage files must be removed through the Storage API, not by
-- deleting storage.objects rows, so the database only records what to remove:
-- * deleting a ride queues everything under <ride_id>/ in ride-voice and
--   journal_photos;
-- * deleting a voice message queues its clip;
-- * deleting a profile (account deletion) queues the rider's avatar folder
--   and every voice clip they recorded (<ride_id>/<user_id>/...).
-- The scheduled purge-location-history function drains the queue with the
-- service role (claim_storage_cleanup / finish_storage_cleanup).

CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  object_name text NOT NULL,
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_name)
);
ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_cleanup_queue FROM anon, authenticated;

-- Queue every stored object in p_bucket whose name matches p_pattern (LIKE).
CREATE OR REPLACE FUNCTION public.queue_storage_cleanup(p_bucket text, p_pattern text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  INSERT INTO public.storage_cleanup_queue (bucket, object_name, reason)
  SELECT o.bucket_id, o.name, p_reason FROM storage.objects o
   WHERE o.bucket_id = p_bucket AND o.name LIKE p_pattern
  ON CONFLICT (bucket, object_name) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_storage_cleanup(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_ride_storage_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.queue_storage_cleanup('ride-voice', OLD.id::text || '/%', 'ride_deleted');
  PERFORM public.queue_storage_cleanup('journal_photos', OLD.id::text || '/%', 'ride_deleted');
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_ride_storage_cleanup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ride_storage_cleanup ON public.rides;
CREATE TRIGGER ride_storage_cleanup AFTER DELETE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.queue_ride_storage_cleanup();

CREATE OR REPLACE FUNCTION public.queue_voice_message_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.voice_path IS NOT NULL THEN
    INSERT INTO public.storage_cleanup_queue (bucket, object_name, reason)
    VALUES ('ride-voice', OLD.voice_path, 'message_deleted')
    ON CONFLICT (bucket, object_name) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_voice_message_cleanup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS voice_message_cleanup ON public.ride_messages;
CREATE TRIGGER voice_message_cleanup AFTER DELETE ON public.ride_messages
  FOR EACH ROW EXECUTE FUNCTION public.queue_voice_message_cleanup();

CREATE OR REPLACE FUNCTION public.queue_profile_storage_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.queue_storage_cleanup('avatars', OLD.id::text || '/%', 'account_deleted');
  PERFORM public.queue_storage_cleanup('ride-voice', '%/' || OLD.id::text || '/%', 'account_deleted');
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_profile_storage_cleanup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profile_storage_cleanup ON public.profiles;
CREATE TRIGGER profile_storage_cleanup AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.queue_profile_storage_cleanup();

-- Service role: take a batch to remove. Rows that keep failing stop after 5 tries.
CREATE OR REPLACE FUNCTION public.claim_storage_cleanup(p_limit integer DEFAULT 500)
RETURNS TABLE (id bigint, bucket text, object_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.storage_cleanup_queue q SET attempts = q.attempts + 1
   WHERE q.id IN (SELECT c.id FROM public.storage_cleanup_queue c WHERE c.attempts < 5
                   ORDER BY c.id LIMIT greatest(least(p_limit, 1000), 1) FOR UPDATE SKIP LOCKED)
  RETURNING q.id, q.bucket, q.object_name;
$$;

CREATE OR REPLACE FUNCTION public.finish_storage_cleanup(p_ids bigint[])
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM public.storage_cleanup_queue WHERE id = ANY(p_ids) RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;

REVOKE ALL ON FUNCTION public.claim_storage_cleanup(integer), public.finish_storage_cleanup(bigint[]) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup(integer), public.finish_storage_cleanup(bigint[]) TO service_role;
  END IF;
END $$;

-- Files left behind by rides and accounts deleted before this migration.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  INSERT INTO public.storage_cleanup_queue (bucket, object_name, reason)
  SELECT o.bucket_id, o.name, 'orphaned'
    FROM storage.objects o
   WHERE o.bucket_id IN ('ride-voice', 'journal_photos')
     AND (storage.foldername(o.name))[1] ~ '^[0-9a-f-]{36}$'
     AND NOT EXISTS (SELECT 1 FROM public.rides r WHERE r.id::text = (storage.foldername(o.name))[1])
  ON CONFLICT (bucket, object_name) DO NOTHING;
  INSERT INTO public.storage_cleanup_queue (bucket, object_name, reason)
  SELECT o.bucket_id, o.name, 'orphaned'
    FROM storage.objects o
   WHERE o.bucket_id = 'avatars'
     AND (storage.foldername(o.name))[1] ~ '^[0-9a-f-]{36}$'
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id::text = (storage.foldername(o.name))[1])
  ON CONFLICT (bucket, object_name) DO NOTHING;
END $$;
