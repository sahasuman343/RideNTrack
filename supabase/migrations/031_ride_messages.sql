-- Migration: In-ride group communication (ride_messages)
BEGIN;

CREATE TABLE IF NOT EXISTS public.ride_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_type text NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'quick_reply', 'pinned_info', 'system')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  attachment_url text,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_messages_ride_created
  ON public.ride_messages (ride_id, created_at DESC);

ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ride messages viewable by participants" ON public.ride_messages;
CREATE POLICY "Ride messages viewable by participants" ON public.ride_messages
  FOR SELECT TO authenticated
  USING (
    public.is_ride_participant(ride_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

DROP POLICY IF EXISTS "Ride messages insertable by participants" ON public.ride_messages;
CREATE POLICY "Ride messages insertable by participants" ON public.ride_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      public.is_ride_participant(ride_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Ride messages updatable by sender or admin" ON public.ride_messages;
CREATE POLICY "Ride messages updatable by sender or admin" ON public.ride_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  )
  WITH CHECK (
    sender_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

DROP POLICY IF EXISTS "Ride messages deletable by sender or admin" ON public.ride_messages;
CREATE POLICY "Ride messages deletable by sender or admin" ON public.ride_messages
  FOR DELETE TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'ride_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;
  END IF;
END $$;

COMMIT;
