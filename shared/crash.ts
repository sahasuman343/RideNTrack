/**
 * F7 crash detection.
 *
 * A pure detector over a stream of motion samples. The phone (foreground
 * sensors today, the native crash-detector module later) feeds samples in; the
 * detector says when it has a crash candidate, or a "hard event" worth
 * recording for tuning. Thresholds are guesses until beta telemetry arrives,
 * so they live in one object that a remote flag payload can override.
 *
 * What a crash looks like here:
 *   1. the bike was moving (speed before the impact over minSpeedBeforeKmh),
 *   2. a short spike over impactG,
 *   3. then the phone stays almost still and slow for stillSeconds.
 * A speed breaker or a pothole fails step 3: the rider keeps moving.
 */

import type { AttentionItem } from './attention';

export interface MotionSample {
  /** Milliseconds since epoch. */
  t: number;
  /** Magnitude of acceleration in g (1 at rest). */
  g: number;
  /** Magnitude of rotation in degrees per second. */
  gyroDps: number;
  /** Latest GPS speed in km/h, or null without a fix. */
  speedKmh: number | null;
}

export interface CrashThresholds {
  impactG: number;
  minSpeedBeforeKmh: number;
  stillSeconds: number;
  stillSpeedKmh: number;
  /** Largest standard deviation of g that still counts as lying still. */
  stillGStdDev: number;
  /** A spike at least this big is recorded for tuning (sensor recorder). */
  recordG: number;
  /** Seconds between two recorded hard events. */
  recordCooldownSeconds: number;
}

export const CRASH_THRESHOLDS: CrashThresholds = {
  impactG: 4.5,
  minSpeedBeforeKmh: 15,
  stillSeconds: 10,
  stillSpeedKmh: 5,
  stillGStdDev: 0.15,
  recordG: 2.5,
  recordCooldownSeconds: 30,
};

/** Merge a flag payload over the defaults, ignoring anything that is not a positive number. */
export function crashThresholdsFrom(payload: Record<string, unknown> | null | undefined): CrashThresholds {
  const out = { ...CRASH_THRESHOLDS };
  if (!payload) return out;
  for (const key of Object.keys(out) as (keyof CrashThresholds)[]) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

export interface CrashWindowSummary {
  peakG: number;
  peakGyroDps: number;
  speedBeforeKmh: number | null;
  speedAfterKmh: number | null;
}

export type CrashDetectorEvent =
  | ({ type: 'candidate'; at: number; confidence: 'medium' | 'high' } & CrashWindowSummary)
  | ({ type: 'hard_event'; at: number; samples: MotionSample[] } & CrashWindowSummary);

const BUFFER_MS = 30_000;
const BEFORE_MS = 5_000;
/** Samples right after the spike bounce around; stillness is measured after this. */
const SETTLE_MS = 2_000;
/** GPS speed lags the real speed by a few seconds; ignore it right after the impact. */
const GPS_SETTLE_MS = 5_000;
const RECORD_AFTER_MS = 5_000;
const MAX_RECORDED_SAMPLES = 300;

function maxOf(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** Keeps the shape of a window under a size cap by taking every nth sample, always keeping the peak. */
export function downsample(samples: MotionSample[], max = MAX_RECORDED_SAMPLES): MotionSample[] {
  if (samples.length <= max) return samples.slice();
  const step = samples.length / max;
  const out: MotionSample[] = [];
  for (let i = 0; i < max; i++) out.push(samples[Math.floor(i * step)]);
  const peak = samples.reduce((a, b) => (b.g > a.g ? b : a));
  if (!out.includes(peak)) {
    // Swap the peak in for the kept sample just before it, so order holds.
    let i = out.length - 1;
    while (i > 0 && out[i].t > peak.t) i--;
    out[i] = peak;
  }
  return out;
}

export interface CrashDetector {
  push(sample: MotionSample): CrashDetectorEvent[];
  reset(): void;
}

/**
 * Feed samples in time order. Returns the events that became certain with this
 * sample (usually none). A candidate is reported once per impact.
 */
export function createCrashDetector(thresholds: CrashThresholds = CRASH_THRESHOLDS): CrashDetector {
  let buffer: MotionSample[] = [];
  let impact: { t: number; peakG: number; peakGyro: number; speedBefore: number | null } | null = null;
  let record: { t: number; peakG: number } | null = null;
  let lastRecordedAt = -Infinity;

  function speedBefore(t: number): number | null {
    return maxOf(buffer.filter(s => s.t >= t - BEFORE_MS && s.t < t && s.speedKmh != null).map(s => s.speedKmh as number));
  }

  function summary(from: number, to: number, peakG: number, peakGyro: number, before: number | null): CrashWindowSummary {
    const after = buffer.filter(s => s.t >= Math.max(from, to - 5_000) && s.t <= to && s.speedKmh != null).map(s => s.speedKmh as number);
    return { peakG, peakGyroDps: peakGyro, speedBeforeKmh: before, speedAfterKmh: maxOf(after) };
  }

  return {
    reset() {
      buffer = [];
      impact = null;
      record = null;
      lastRecordedAt = -Infinity;
    },
    push(sample) {
      const events: CrashDetectorEvent[] = [];
      if (!Number.isFinite(sample.t) || !Number.isFinite(sample.g)) return events;
      buffer.push(sample);
      while (buffer.length && buffer[0].t < sample.t - BUFFER_MS) buffer.shift();

      // Recorder: remember the biggest spike, write it out a few seconds later.
      if (sample.g >= thresholds.recordG && sample.t - lastRecordedAt >= thresholds.recordCooldownSeconds * 1000) {
        if (!record || sample.g > record.peakG) record = { t: sample.t, peakG: sample.g };
      }
      if (record && sample.t - record.t >= RECORD_AFTER_MS) {
        const window = buffer.filter(s => s.t >= record!.t - BEFORE_MS && s.t <= sample.t);
        const peakGyro = Math.max(0, ...window.map(s => s.gyroDps || 0));
        events.push({
          type: 'hard_event',
          at: record.t,
          samples: downsample(window),
          ...summary(record.t, sample.t, record.peakG, peakGyro, speedBefore(record.t)),
        });
        lastRecordedAt = record.t;
        record = null;
      }

      // Detector: a spike while moving opens a watch; stillness confirms it.
      if (!impact && sample.g >= thresholds.impactG) {
        const before = speedBefore(sample.t);
        // Without any GPS speed we cannot tell a dropped phone from a crash at speed; stay quiet.
        if (before != null && before >= thresholds.minSpeedBeforeKmh) {
          impact = { t: sample.t, peakG: sample.g, peakGyro: sample.gyroDps || 0, speedBefore: before };
        }
      } else if (impact) {
        if (sample.t - impact.t <= SETTLE_MS) {
          impact.peakG = Math.max(impact.peakG, sample.g);
          impact.peakGyro = Math.max(impact.peakGyro, sample.gyroDps || 0);
        }
        if (sample.speedKmh != null && sample.t - impact.t > GPS_SETTLE_MS && sample.speedKmh > thresholds.stillSpeedKmh) {
          impact = null; // kept riding: speed breaker, pothole or a hard stop.
        } else if (sample.t - impact.t >= (thresholds.stillSeconds * 1000) + SETTLE_MS) {
          const settled = buffer.filter(s => s.t >= impact!.t + SETTLE_MS);
          if (stdDev(settled.map(s => s.g)) <= thresholds.stillGStdDev) {
            const s = summary(impact.t + SETTLE_MS, sample.t, impact.peakG, impact.peakGyro, impact.speedBefore);
            const confidence = impact.peakG >= thresholds.impactG * 1.5 || impact.peakGyro >= 300 ? 'high' : 'medium';
            events.push({ type: 'candidate', at: impact.t, confidence, ...s });
          }
          impact = null;
        }
      }
      return events;
    },
  };
}

/** Seconds the rider has to say they are OK before the pack and contacts are told. */
export const CRASH_COUNTDOWN_SECONDS = 45;

/** Spoken through the headset and shown on screen. */
export const CRASH_SPOKEN_PROMPT = 'Are you OK? Tap anywhere on your phone to cancel.';

/** What the pack sees while the countdown runs. Family hears nothing yet. */
export const POSSIBLE_CRASH_MESSAGE = 'Possible crash, confirming. Do not call yet.';

export function crashCountdownAttention(secondsLeft: number, nowIso: string): AttentionItem {
  return {
    id: 'crash:countdown',
    kind: 'crash_countdown',
    title: 'Are you OK?',
    body: 'It looks like you may have crashed. At zero your pack is alerted and your contacts get a text.',
    createdAt: nowIso,
    sticky: true,
    countdownSeconds: Math.max(0, Math.ceil(secondsLeft)),
    actions: [
      { id: 'crash_ok', label: "I'm OK", emphasis: 'primary' },
      { id: 'crash_help', label: 'Get help now', emphasis: 'danger' },
    ],
  };
}

/** Haptic bursts get stronger as the countdown runs out. */
export function crashHapticStrength(secondsLeft: number): 'light' | 'medium' | 'heavy' {
  if (secondsLeft <= 10) return 'heavy';
  if (secondsLeft <= 25) return 'medium';
  return 'light';
}

/** Repeat the spoken prompt at the start, at 30 s and at 15 s left. */
export function shouldSpeakCrashPrompt(secondsLeft: number, total = CRASH_COUNTDOWN_SECONDS): boolean {
  const s = Math.ceil(secondsLeft);
  return s === total || s === 30 || s === 15;
}

export type CrashTelemetryKind = 'hard_event' | 'candidate' | 'false_alarm' | 'confirmed' | 'help_requested';

export interface CrashTelemetryRow {
  ride_id: string | null;
  kind: CrashTelemetryKind;
  peak_g: number;
  peak_gyro_dps: number;
  speed_before_kmh: number | null;
  speed_after_kmh: number | null;
  samples: MotionSample[] | null;
  platform: string;
  detector: 'foreground' | 'native';
}

export function crashTelemetryRow(
  kind: CrashTelemetryKind,
  event: CrashWindowSummary & { samples?: MotionSample[] },
  context: { rideId: string | null; platform: string; detector: 'foreground' | 'native' },
): CrashTelemetryRow {
  const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    ride_id: context.rideId,
    kind,
    peak_g: round(event.peakG) ?? 0,
    peak_gyro_dps: round(event.peakGyroDps, 0) ?? 0,
    speed_before_kmh: round(event.speedBeforeKmh, 1),
    speed_after_kmh: round(event.speedAfterKmh, 1),
    samples: event.samples
      ? downsample(event.samples).map(s => ({ t: s.t, g: round(s.g)!, gyroDps: round(s.gyroDps, 0)!, speedKmh: round(s.speedKmh, 1) }))
      : null,
    platform: context.platform,
    detector: context.detector,
  };
}
