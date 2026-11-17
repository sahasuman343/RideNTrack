-- Phase 2 Milestone 4: Regroup alerts & SOS safety extension
BEGIN;

ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('emergency','break','fuel','mechanical','route_deviation','rider_behind','regroup'));

COMMIT;
