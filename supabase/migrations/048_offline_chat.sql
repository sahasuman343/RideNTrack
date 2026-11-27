-- F8 offline chat: messages written with no signal are queued on the phone and
-- sent later with a client id, so a retry after a lost acknowledgement never
-- posts the same message twice. client_created_at keeps the order the rider
-- wrote them in; created_at stays the server arrival time.
BEGIN;

ALTER TABLE public.ride_messages
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS client_created_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ride_messages_client_id_key') THEN
    ALTER TABLE public.ride_messages ADD CONSTRAINT ride_messages_client_id_key UNIQUE (client_id);
  END IF;
END $$;

-- A phone clock can be wrong; never accept a client time from the future or
-- from before the message could have been written (older than a week).
CREATE OR REPLACE FUNCTION public.clamp_ride_message_client_time()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.client_created_at IS NULL OR NEW.client_created_at > now() THEN
    NEW.client_created_at := now();
  ELSIF NEW.client_created_at < now() - interval '7 days' THEN
    NEW.client_created_at := now() - interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clamp_ride_message_client_time ON public.ride_messages;
CREATE TRIGGER clamp_ride_message_client_time BEFORE INSERT ON public.ride_messages
  FOR EACH ROW EXECUTE FUNCTION public.clamp_ride_message_client_time();

COMMIT;
