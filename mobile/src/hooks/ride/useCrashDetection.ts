import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  CRASH_COUNTDOWN_SECONDS,
  CRASH_SPOKEN_PROMPT,
  POSSIBLE_CRASH_MESSAGE,
  createCrashDetector,
  crashHapticStrength,
  crashTelemetryRow,
  crashThresholdsFrom,
  shouldSpeakCrashPrompt,
  type AlertType,
  type CrashTelemetryKind,
  type CrashWindowSummary,
  type LocationUpdate,
  type MotionSample,
} from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';
import { crashSensorSource, startCrashSensors } from '../../services/crashSensors';
import { playHaptic } from '../../services/haptics';
import { playAlertSound } from '../../services/alertSound';
import { track } from '../../services/analytics';
import { useLocale } from '../useLocale';

/*
 * F7 crash detection on the ride screen.
 *
 * Detection (flag crash_detection_beta) runs a 45 s countdown when the
 * detector sees a crash: full screen, strong haptics, the question spoken
 * through the headset. The pack sees "Possible crash, confirming" right away;
 * family hears nothing unless the countdown runs out.
 *
 * The recorder (flag sensor_recorder, plus the rider's research consent)
 * saves short motion windows around hard events so thresholds can be tuned.
 */

type SpeechModule = typeof import('expo-speech');
let speech: SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  speech = require('expo-speech') as SpeechModule;
} catch {
  speech = null;
}

function speak(text: string, language = 'en-IN') {
  try {
    speech?.stop();
    speech?.speak(text, { language, rate: 0.95 });
  } catch {
    /* no speech engine: haptics and the screen still carry it */
  }
}

const HAPTIC_FOR_STRENGTH = { light: 'nudge', medium: 'urgent', heavy: 'sos' } as const;

export function useCrashDetection(params: {
  rideId: string | null | undefined;
  userId: string | null | undefined;
  active: boolean;
  position: LocationUpdate | null;
  online: boolean;
  detectionEnabled: boolean;
  recorderEnabled: boolean;
  researchConsent: boolean;
  thresholdsPayload: Record<string, unknown> | null;
  sendAlert: (type: AlertType, message?: string) => Promise<'sent' | 'queued' | 'failed'>;
  escalate: () => Promise<void> | void;
}) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const { locale, t } = useLocale();
  const deadline = useRef<number | null>(null);
  const lastCandidate = useRef<CrashWindowSummary | null>(null);
  const latest = useRef(params);
  latest.current = params;
  const speedRef = useRef<number | null>(null);
  speedRef.current = params.position && Number.isFinite(params.position.speed) ? Math.max(0, params.position.speed * 3.6) : null;

  const recording = params.recorderEnabled && params.researchConsent;
  const sensing = params.active && (params.detectionEnabled || recording);
  const thresholdsKey = JSON.stringify(params.thresholdsPayload ?? {});

  const saveTelemetry = useCallback((kind: CrashTelemetryKind, summary: CrashWindowSummary & { samples?: MotionSample[] }) => {
    const { userId, rideId, online, researchConsent } = latest.current;
    if (!userId || !online) return;
    // Motion samples only with consent; outcome feedback always (it carries no samples).
    const withSamples = researchConsent ? summary : { ...summary, samples: undefined };
    if (!researchConsent && (kind === 'hard_event' || kind === 'candidate')) return;
    const row = crashTelemetryRow(kind, withSamples, { rideId: rideId ?? null, platform: Platform.OS, detector: crashSensorSource() });
    // Research data: a failed write is dropped rather than retried on the road.
    void supabase.from('crash_telemetry').insert({ ...row, user_id: userId });
  }, []);

  const startCountdown = useCallback((candidate: CrashWindowSummary) => {
    if (deadline.current != null) return;
    lastCandidate.current = candidate;
    deadline.current = Date.now() + CRASH_COUNTDOWN_SECONDS * 1000;
    setSecondsLeft(CRASH_COUNTDOWN_SECONDS);
    track('crash_candidate', { source: crashSensorSource() });
    void latest.current.sendAlert('possible_crash', POSSIBLE_CRASH_MESSAGE);
    void playAlertSound(true);
  }, []);

  const stopCountdown = useCallback(() => {
    deadline.current = null;
    setSecondsLeft(null);
    try { speech?.stop(); } catch { /* ignore */ }
  }, []);

  // Sensors: on only while riding with a feature that needs them.
  useEffect(() => {
    if (!sensing) return;
    const detector = createCrashDetector(crashThresholdsFrom(JSON.parse(thresholdsKey) as Record<string, unknown>));
    let stop: (() => void) | null = null;
    let cancelled = false;
    void startCrashSensors(sample => {
      for (const event of detector.push(sample)) {
        if (event.type === 'hard_event') {
          if (latest.current.recorderEnabled) saveTelemetry('hard_event', event);
        } else {
          if (latest.current.recorderEnabled) saveTelemetry('candidate', event);
          if (latest.current.detectionEnabled) startCountdown(event);
        }
      }
    }, () => speedRef.current).then(fn => {
      if (cancelled) fn();
      else stop = fn;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [sensing, thresholdsKey, saveTelemetry, startCountdown]);

  // Countdown tick: one haptic burst a second, stronger near zero; spoken prompt at marks.
  useEffect(() => {
    if (secondsLeft == null) return;
    const t = setInterval(() => {
      if (deadline.current == null) return;
      const left = Math.max(0, (deadline.current - Date.now()) / 1000);
      const whole = Math.ceil(left);
      setSecondsLeft(prev => (prev === whole ? prev : whole));
      if (left <= 0) {
        stopCountdown();
        track('crash_escalated', { reason: 'no_answer' });
        if (lastCandidate.current) saveTelemetry('confirmed', lastCandidate.current);
        void latest.current.escalate();
      }
    }, 250);
    return () => clearInterval(t);
  }, [secondsLeft != null, stopCountdown, saveTelemetry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0) return;
    void playHaptic(HAPTIC_FOR_STRENGTH[crashHapticStrength(secondsLeft)]);
    if (shouldSpeakCrashPrompt(secondsLeft)) speak(locale === 'en' ? CRASH_SPOKEN_PROMPT : t('crash.spoken'), locale === 'hi' ? 'hi-IN' : 'en-IN');
  }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the ride never leaves a countdown running in the background.
  useEffect(() => {
    if (!params.active && deadline.current != null) stopCountdown();
  }, [params.active, stopCountdown]);

  /** "I'm OK": the pack is told it was a false alarm; the outcome is recorded. */
  const cancelCrash = useCallback(() => {
    if (deadline.current == null) return;
    stopCountdown();
    track('crash_false_alarm', {});
    void latest.current.sendAlert('crash_cancelled', "I'm OK. False alarm.");
    if (lastCandidate.current) saveTelemetry('false_alarm', lastCandidate.current);
    void playHaptic('success');
  }, [stopCountdown, saveTelemetry]);

  /** "Get help now": skip the wait. */
  const requestHelp = useCallback(() => {
    if (deadline.current == null) return;
    stopCountdown();
    track('crash_escalated', { reason: 'help_requested' });
    if (lastCandidate.current) saveTelemetry('help_requested', lastCandidate.current);
    void latest.current.escalate();
  }, [stopCountdown, saveTelemetry]);

  return { secondsLeft, cancelCrash, requestHelp, sensing, source: crashSensorSource() };
}
