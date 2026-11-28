import { useEffect, useMemo, useRef } from 'react';
import { framesPerSecond, jankShare, type PerformanceProfile } from '@ridentrack/shared';
import { useFlag, useFlagPayload } from '../useFeatureFlags';
import { devicePerformanceProfile } from '../../services/deviceTier';
import { track } from '../../services/analytics';

/** F14: the ride screen's performance tier, from the phone and the low_end_tuning flag. */
export function usePerformanceProfile(): PerformanceProfile {
  const enabled = useFlag('low_end_tuning');
  const payload = useFlagPayload('low_end_tuning');
  return useMemo(() => devicePerformanceProfile(enabled, payload), [enabled, payload]);
}

const SAMPLE_MS = 10_000;
const EVERY_MS = 5 * 60_000;

/**
 * F14: while the ride screen is open, count frames for 10 s every 5 minutes
 * and record the frame rate and stutter share (no location, no ids).
 */
export function useFrameRateSampler(active: boolean, profile: PerformanceProfile) {
  const enabled = useFlag('perf_sampling');
  const tier = profile.tier;
  const frames = useRef<number[]>([]);
  useEffect(() => {
    if (!enabled || !active) return;
    let raf: number | null = null;
    let stopAt = 0;
    const tick = (t: number) => {
      frames.current.push(t);
      if (t < stopAt) { raf = requestAnimationFrame(tick); return; }
      const fps = framesPerSecond(frames.current);
      track('ride_perf_sample', { fps, jank: jankShare(frames.current), tier });
      frames.current = [];
      raf = null;
    };
    const sample = () => {
      if (raf != null) return;
      frames.current = [];
      stopAt = performance.now() + SAMPLE_MS;
      raf = requestAnimationFrame(tick);
    };
    const first = setTimeout(sample, 30_000);
    const timer = setInterval(sample, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [enabled, active, tier]);
}
