/**
 * F14 low-end Android tuning.
 *
 * Phones with 3 GB of RAM or less (Redmi, Realme, Samsung M series) are a
 * large share of riders. They get a lighter ride screen: a shorter on-map
 * trail, a slower HUD and fewer map labels. Everything a rider needs for
 * safety (SOS, alerts, pack dots) is the same on every tier.
 */

export type DeviceTier = 'low' | 'standard';

export interface DeviceFacts {
  /** Bytes; null when the platform does not say. */
  totalMemory?: number | null;
  /** expo-device deviceYearClass: the year the phone's specs were flagship. */
  yearClass?: number | null;
  platform?: string | null;
}

const GB = 1024 ** 3;
/** Phones sold as "3 GB" report a little under 3 GiB. */
export const LOW_END_MEMORY_BYTES = 3.5 * GB;
export const LOW_END_YEAR_CLASS = 2016;

export function deviceTier(facts: DeviceFacts): DeviceTier {
  if (facts.platform === 'ios') return 'standard';
  if (typeof facts.totalMemory === 'number' && facts.totalMemory > 0 && facts.totalMemory <= LOW_END_MEMORY_BYTES) return 'low';
  if (typeof facts.yearClass === 'number' && facts.yearClass > 0 && facts.yearClass <= LOW_END_YEAR_CLASS) return 'low';
  return 'standard';
}

export interface PerformanceProfile {
  tier: DeviceTier;
  /** Points kept for the rider's own trail on the map (distance is unaffected). */
  trailMaxPoints: number;
  /** How often the HUD numbers update. */
  hudIntervalMs: number;
  /** Rider name labels show only from this zoom. */
  riderLabelMinZoom: number;
  /** Road report labels show only from this zoom. */
  roadReportLabelMinZoom: number;
}

export const PERFORMANCE_PROFILES: Record<DeviceTier, PerformanceProfile> = {
  standard: { tier: 'standard', trailMaxPoints: 2000, hudIntervalMs: 1000, riderLabelMinZoom: 0, roadReportLabelMinZoom: 11 },
  low: { tier: 'low', trailMaxPoints: 600, hudIntervalMs: 2000, riderLabelMinZoom: 11, roadReportLabelMinZoom: 13 },
};

/** Remote flag payload can force a tier for testing, e.g. {"tier": "low"}. */
export function performanceProfile(facts: DeviceFacts, override?: Record<string, unknown> | null): PerformanceProfile {
  const forced = override?.tier;
  const tier: DeviceTier = forced === 'low' || forced === 'standard' ? forced : deviceTier(facts);
  return PERFORMANCE_PROFILES[tier];
}

/**
 * The budget a ride-screen change must keep on a 3 GB Android phone,
 * measured with the map open, 15 riders moving and the HUD running.
 */
export const PERFORMANCE_BUDGET = {
  minFps: 50,
  maxJsHeapMb: 180,
  maxColdStartToMapMs: 4000,
} as const;

/** Frame rate from frame timestamps (ms), ignoring the first frame. */
export function framesPerSecond(frameTimes: number[]): number | null {
  if (frameTimes.length < 2) return null;
  const span = frameTimes[frameTimes.length - 1] - frameTimes[0];
  if (span <= 0) return null;
  return Math.round(((frameTimes.length - 1) * 1000) / span);
}

/** Share of frames that took longer than two 60 Hz frames (visible stutter). */
export function jankShare(frameTimes: number[], slowMs = 34): number {
  if (frameTimes.length < 2) return 0;
  let slow = 0;
  for (let i = 1; i < frameTimes.length; i++) if (frameTimes[i] - frameTimes[i - 1] > slowMs) slow++;
  return Math.round((slow / (frameTimes.length - 1)) * 1000) / 1000;
}

export function withinBudget(sample: { fps: number | null; jsHeapMb?: number | null }): boolean {
  if (sample.fps != null && sample.fps < PERFORMANCE_BUDGET.minFps) return false;
  if (sample.jsHeapMb != null && sample.jsHeapMb > PERFORMANCE_BUDGET.maxJsHeapMb) return false;
  return true;
}
