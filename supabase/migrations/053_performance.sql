-- F14 low-end Android tuning flags (values match shared/flags.ts).
INSERT INTO public.app_flags (key, description, enabled) VALUES
  ('low_end_tuning', 'F14: lighter ride screen on 3 GB Android phones; payload {"tier":"low"} forces a tier', true),
  ('perf_sampling', 'F14: sample ride-screen frame rate into analytics (no location)', false)
ON CONFLICT (key) DO NOTHING;
