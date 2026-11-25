/*
 * F4 Battery budget. No setting to choose: the GPS profile follows the
 * rider's role (lead and sweep need precise, frequent fixes; the middle of the
 * pack does not), and drops to a slow rate while stopped. The rider sees one
 * sentence, e.g. "About 35% over 8 hours".
 *
 * Drain figures are % of a typical 5,000 mAh phone per hour and come from a
 * first bench estimate; replace them with the measured 8-hour field test.
 */

export type GpsProfile = 'high' | 'balanced' | 'stopped';

export interface GpsProfileSpec { intervalMs: number; distanceM: number; accuracy: 'high' | 'balanced' }

export const GPS_PROFILES: Record<GpsProfile, GpsProfileSpec> = {
  high: { intervalMs: 5_000, distanceM: 15, accuracy: 'high' },
  balanced: { intervalMs: 15_000, distanceM: 50, accuracy: 'balanced' },
  stopped: { intervalMs: 60_000, distanceM: 100, accuracy: 'balanced' },
};

export const STOPPED_PROFILE_AFTER_MS = 3 * 60 * 1000;
export const PROFILE_SWITCH_MIN_GAP_MS = 60 * 1000;

const PRECISE_ROLES = new Set(['captain', 'co-captain', 'leader', 'sweeper', 'sweep']);

export function profileForRole(role: string | null | undefined, options: { stoppedForMs?: number | null } = {}): GpsProfile {
  if (options.stoppedForMs != null && options.stoppedForMs >= STOPPED_PROFILE_AFTER_MS) return 'stopped';
  return role && PRECISE_ROLES.has(role) ? 'high' : 'balanced';
}

/** Restarting the location task can drop a fix, so switch at most once a minute. */
export function shouldSwitchProfile(current: GpsProfile | null, next: GpsProfile, lastSwitchAtMs: number | null, nowMs: number): boolean {
  if (current === next) return false;
  if (current === null || lastSwitchAtMs === null) return true;
  return nowMs - lastSwitchAtMs >= PROFILE_SWITCH_MIN_GAP_MS;
}

/** % per hour with the screen off. */
export const DRAIN_PER_HOUR: Record<GpsProfile, number> = { high: 8, balanced: 5, stopped: 2.5 };
/** Extra % per hour while the ride screen is on (map + display). */
export const SCREEN_ON_EXTRA_PER_HOUR = 9;
/** Share of a riding day a typical rider spends stopped (breaks, fuel, food). */
export const TYPICAL_STOPPED_SHARE = 0.25;

export interface BatteryEstimate { usedPercent: number; endPercent: number | null; enough: boolean; sentence: string }

export function estimateBattery(input: {
  role?: string | null;
  hours: number;
  levelPercent?: number | null;
  screenOnShare?: number;
  stoppedShare?: number;
}): BatteryEstimate {
  const hours = Math.max(0.5, Math.min(16, input.hours || 8));
  const moving = profileForRole(input.role);
  const stoppedShare = input.stoppedShare ?? TYPICAL_STOPPED_SHARE;
  const screen = input.screenOnShare ?? 0.1;
  const perHour = DRAIN_PER_HOUR[moving] * (1 - stoppedShare) + DRAIN_PER_HOUR.stopped * stoppedShare + SCREEN_ON_EXTRA_PER_HOUR * screen;
  const usedPercent = Math.round((perHour * hours) / 5) * 5;
  const h = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  const level = input.levelPercent != null && Number.isFinite(input.levelPercent) ? Math.round(input.levelPercent) : null;
  const endPercent = level != null ? Math.max(0, level - usedPercent) : null;
  const enough = endPercent == null ? usedPercent <= 80 : endPercent >= 15;
  let sentence = `About ${usedPercent}% over ${h} hours`;
  if (endPercent != null) sentence += enough ? `. You'd finish near ${endPercent}%.` : `. Charge up or carry a power bank: you'd run out around ${Math.max(1, Math.round((level as number) / perHour))} h in.`;
  else sentence += '.';
  return { usedPercent, endPercent, enough, sentence };
}

export const LOW_BATTERY_PERCENT = 20;
export const CRITICAL_BATTERY_PERCENT = 10;

/** Hours of tracking left at the current profile, for the low-battery item. */
export function hoursLeft(levelPercent: number, profile: GpsProfile, screenOnShare = 0.1): number {
  const perHour = DRAIN_PER_HOUR[profile] + SCREEN_ON_EXTRA_PER_HOUR * screenOnShare;
  return Math.max(0, Math.round((levelPercent / perHour) * 10) / 10);
}
