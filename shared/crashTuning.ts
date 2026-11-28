/**
 * F7 general availability: tune the crash thresholds from beta telemetry,
 * then decide whether detection can be on for everyone.
 *
 * Every hard event over `recordG` is saved (with consent) with its peak and
 * the speed before it, and every countdown ends as a false alarm, a
 * confirmed crash or a help request. That is enough to ask "with these
 * thresholds, how many countdowns would riders have seen, and would we have
 * caught every real crash?" without replaying raw sensor streams.
 */

import { CRASH_THRESHOLDS, type CrashThresholds } from './crash';

export type TelemetryKind = 'hard_event' | 'candidate' | 'false_alarm' | 'confirmed' | 'help_requested';

export interface TelemetrySummaryRow {
  kind: TelemetryKind;
  peak_g: number;
  speed_before_kmh: number | null;
}

export interface ThresholdEvaluation {
  thresholds: Pick<CrashThresholds, 'impactG' | 'minSpeedBeforeKmh'>;
  /** Non-crash events that would have started a countdown. */
  falseAlarms: number;
  /** Real crashes that would have started a countdown. */
  caught: number;
  /** Real crashes these thresholds would have missed. */
  missed: number;
  falseAlarmsPer1000h: number | null;
}

/** The plan's goal for turning detection on for everyone. */
export const GA_TARGET = {
  maxFalseAlarmsPer1000h: 1,
  minRidingHours: 500,
  /** A real crash the thresholds would miss blocks GA outright. */
  maxMissed: 0,
} as const;

const isCrash = (k: TelemetryKind) => k === 'confirmed' || k === 'help_requested';

function triggers(row: TelemetrySummaryRow, t: Pick<CrashThresholds, 'impactG' | 'minSpeedBeforeKmh'>) {
  return row.peak_g >= t.impactG && (row.speed_before_kmh ?? 0) >= t.minSpeedBeforeKmh;
}

export function perThousandHours(count: number, ridingHours: number): number | null {
  if (!(ridingHours > 0)) return null;
  return Math.round((count / ridingHours) * 1000 * 100) / 100;
}

/**
 * How a pair of thresholds would have done on the beta's events. Countdown
 * outcome rows (false_alarm, confirmed) describe the same impact as their
 * candidate row, so only hard events and outcomes are counted.
 */
export function evaluateThresholds(
  rows: TelemetrySummaryRow[],
  ridingHours: number,
  thresholds: Pick<CrashThresholds, 'impactG' | 'minSpeedBeforeKmh'> = CRASH_THRESHOLDS,
): ThresholdEvaluation {
  let falseAlarms = 0;
  let caught = 0;
  let missed = 0;
  for (const row of rows) {
    if (row.kind === 'candidate') continue;
    const hit = triggers(row, thresholds);
    if (isCrash(row.kind)) { if (hit) caught++; else missed++; }
    else if (hit) falseAlarms++;
  }
  return { thresholds, falseAlarms, caught, missed, falseAlarmsPer1000h: perThousandHours(falseAlarms, ridingHours) };
}

/** Try a grid of thresholds; best first (no misses, then fewest false alarms, then the most sensitive). */
export function sweepThresholds(
  rows: TelemetrySummaryRow[],
  ridingHours: number,
  grid: { impactG: number[]; minSpeedBeforeKmh: number[] } = { impactG: [3.5, 4, 4.5, 5, 5.5, 6, 7], minSpeedBeforeKmh: [10, 15, 20, 25] },
): ThresholdEvaluation[] {
  const out: ThresholdEvaluation[] = [];
  for (const impactG of grid.impactG) for (const minSpeedBeforeKmh of grid.minSpeedBeforeKmh) {
    out.push(evaluateThresholds(rows, ridingHours, { impactG, minSpeedBeforeKmh }));
  }
  return out.sort((a, b) => a.missed - b.missed || a.falseAlarms - b.falseAlarms
    || a.thresholds.impactG - b.thresholds.impactG || a.thresholds.minSpeedBeforeKmh - b.thresholds.minSpeedBeforeKmh);
}

export interface GaReadiness {
  ready: boolean;
  /** Plain sentences, for the go / no-go note. */
  reasons: string[];
}

export function crashGaReadiness(evaluation: ThresholdEvaluation, ridingHours: number): GaReadiness {
  const reasons: string[] = [];
  if (ridingHours < GA_TARGET.minRidingHours) {
    reasons.push(`Only ${Math.round(ridingHours)} riding hours of beta data; need ${GA_TARGET.minRidingHours}.`);
  }
  if (evaluation.missed > GA_TARGET.maxMissed) {
    reasons.push(`${evaluation.missed} real crash${evaluation.missed === 1 ? '' : 'es'} would not have started a countdown.`);
  }
  const rate = evaluation.falseAlarmsPer1000h;
  if (rate == null || rate >= GA_TARGET.maxFalseAlarmsPer1000h) {
    reasons.push(`${rate ?? 'Unknown'} false alarms per 1,000 riding hours; the goal is under ${GA_TARGET.maxFalseAlarmsPer1000h}.`);
  }
  return { ready: reasons.length === 0, reasons };
}
