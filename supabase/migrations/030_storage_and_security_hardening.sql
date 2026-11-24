-- Migration 030: Supabase Storage Policies and RLS Policy Hardening
BEGIN;

-- 1. Hardening rides UPDATE policy to enforce explicit WITH CHECK
DROP POLICY IF EXISTS "Admin can update ride" ON public.rides;
CREATE POLICY "Admin can update ride" ON public.rides
  FOR UPDATE TO PUBLIC
  USING (auth.uid() = admin_id)
  WITH CHECK (auth.uid() = admin_id);

-- 2. Track push notification delivery timestamps for atomic cross-isolate rate limiting
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- 3. Storage Buckets & Policies (Executed conditionally if storage extension/schema is present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('avatars', 'avatars', false), ('journal_photos', 'journal_photos', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    -- Note: storage.objects has RLS enabled by default in Supabase; omit ALTER TABLE as storage.objects is owned by supabase_storage_admin

    -- Avatars: User can insert/update/delete their own avatar within their user_id prefix folder
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users manage own avatar') THEN
      CREATE POLICY "Users manage own avatar" ON storage.objects
        FOR ALL TO authenticated
        USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
        WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
    END IF;

    -- Avatars: Any authenticated user can read avatars for profile displays
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated view avatars') THEN
      CREATE POLICY "Authenticated view avatars" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'avatars');
    END IF;

    -- Journal Photos: Participants in the ride can view journal photos
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Participants view trip photos') THEN
      CREATE POLICY "Participants view trip photos" ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id = 'journal_photos'
          AND EXISTS (
            SELECT 1 FROM public.ride_participants rp
            WHERE rp.ride_id::text = (storage.foldername(name))[1]
              AND rp.user_id = auth.uid()
              AND rp.is_active = true
          )
        );
    END IF;

    -- Journal Photos: Participants in the ride can upload journal photos to that ride's folder
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Participants upload trip photos') THEN
      CREATE POLICY "Participants upload trip photos" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'journal_photos'
          AND EXISTS (
            SELECT 1 FROM public.ride_participants rp
            WHERE rp.ride_id::text = (storage.foldername(name))[1]
              AND rp.user_id = auth.uid()
              AND rp.is_active = true
          )
        );
    END IF;
  END IF;
END $$;

COMMIT;
