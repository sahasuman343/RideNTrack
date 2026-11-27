-- F7 crash detection beta (flag crash_detection_beta) and the hidden sensor
-- recorder (flag sensor_recorder).
--
-- The pack sees "possible_crash" while the 45 s countdown runs. The rider
-- either cancels ("crash_cancelled") or the countdown runs out
-- ("crash_detected"). Family contacts hear only about crash_detected.
BEGIN;

ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('emergency','break','fuel','mechanical','route_deviation','rider_behind','regroup','announcement','check_in_missed',
                  'possible_crash','crash_cancelled','crash_detected'));

-- A crash can happen before the first GPS fix, like an SOS.
DROP POLICY IF EXISTS "Members insert own alerts" ON public.alerts;
CREATE POLICY "Members insert own alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_ride_participant(ride_id, auth.uid())
    AND (
      (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
      OR (type IN ('emergency', 'check_in_missed', 'possible_crash', 'crash_cancelled', 'crash_detected') AND lat IS NULL AND lng IS NULL)
    )
    AND (location_recorded_at IS NULL OR location_recorded_at <= now() + interval '2 minutes')
    AND (
      type IS DISTINCT FROM 'announcement'
      OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.admin_id = auth.uid())
    )
  );

-- Family hears about a crash only when the rider did not cancel it.
CREATE OR REPLACE FUNCTION public.family_on_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type = 'check_in_missed' THEN
    PERFORM public.notify_family(NEW.ride_id, NEW.user_id, 'family_check_in_missed', jsonb_build_object('minutes', '2'), 'family_checkin:' || NEW.id::text);
  ELSIF NEW.type = 'crash_detected' THEN
    PERFORM public.notify_family(NEW.ride_id, NEW.user_id, 'family_crash', '{}'::jsonb, 'family_crash:' || NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.family_on_alert() FROM PUBLIC, anon, authenticated;

-- Consent for the sensor recorder. False alarms and confirmed crashes are
-- always recorded without samples; motion samples need this consent.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS crash_research_consent_at timestamptz;

CREATE TABLE IF NOT EXISTS public.crash_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('hard_event', 'candidate', 'false_alarm', 'confirmed', 'help_requested')),
  peak_g numeric(6,2) NOT NULL DEFAULT 0 CHECK (peak_g >= 0 AND peak_g < 100),
  peak_gyro_dps numeric(7,0) NOT NULL DEFAULT 0 CHECK (peak_gyro_dps >= 0 AND peak_gyro_dps < 100000),
  speed_before_kmh numeric(5,1) CHECK (speed_before_kmh IS NULL OR speed_before_kmh BETWEEN 0 AND 400),
  speed_after_kmh numeric(5,1) CHECK (speed_after_kmh IS NULL OR speed_after_kmh BETWEEN 0 AND 400),
  samples jsonb CHECK (samples IS NULL OR (jsonb_typeof(samples) = 'array' AND jsonb_array_length(samples) <= 300)),
  platform text NOT NULL DEFAULT 'unknown' CHECK (length(platform) <= 20),
  detector text NOT NULL DEFAULT 'foreground' CHECK (detector IN ('foreground', 'native')),
  note text CHECK (note IS NULL OR length(note) <= 280),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crash_telemetry_kind ON public.crash_telemetry (kind, created_at DESC);
ALTER TABLE public.crash_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Riders read own crash telemetry" ON public.crash_telemetry;
CREATE POLICY "Riders read own crash telemetry" ON public.crash_telemetry
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Riders add own crash telemetry" ON public.crash_telemetry;
CREATE POLICY "Riders add own crash telemetry" ON public.crash_telemetry
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (ride_id IS NULL OR public.is_ride_participant(ride_id, auth.uid()))
    AND (
      -- Outcome feedback without motion data needs no research consent.
      (kind IN ('false_alarm', 'confirmed', 'help_requested') AND samples IS NULL)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.crash_research_consent_at IS NOT NULL)
    )
  );

-- Riders can withdraw consent and wipe their samples in one step.
CREATE OR REPLACE FUNCTION public.set_crash_research_consent(p_on boolean)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '28000'; END IF;
  IF p_on THEN
    UPDATE public.profiles SET crash_research_consent_at = coalesce(crash_research_consent_at, now()) WHERE id = v_uid
    RETURNING crash_research_consent_at INTO v_at;
  ELSE
    UPDATE public.profiles SET crash_research_consent_at = NULL WHERE id = v_uid;
    DELETE FROM public.crash_telemetry WHERE user_id = v_uid AND samples IS NOT NULL;
  END IF;
  RETURN v_at;
END;
$$;
REVOKE ALL ON FUNCTION public.set_crash_research_consent(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_crash_research_consent(boolean) TO authenticated;

COMMIT;
