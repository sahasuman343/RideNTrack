import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  isAnalyticsEvent,
  sanitizeEventProps,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from '@ridentrack/shared';
import { supabase } from '../lib/supabase';

/*
 * Privacy-first event analytics. Events are batched in memory and written to
 * the app_events table through log_app_events (no location, no names, no free
 * text: see shared/analytics.ts). If EXPO_PUBLIC_POSTHOG_KEY is set the same
 * sanitised batch is also sent to PostHog's capture API; nothing else changes.
 * Turning analytics off is EXPO_PUBLIC_ANALYTICS=off.
 */

const ENABLED = process.env.EXPO_PUBLIC_ANALYTICS !== 'off';
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY || '';
const POSTHOG_HOST = (process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '');
const FLUSH_AT = 20;
const FLUSH_INTERVAL_MS = 30_000;
const MAX_BUFFER = 200;

const sessionId = randomId();
const appVersion = (Constants.expoConfig?.version as string | undefined) ?? null;
let buffer: AnalyticsEvent[] = [];
let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;
let distinctId: string | null = null;

function randomId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-8${out.slice(17, 20)}-${out.slice(20)}`;
}

export function identifyAnalyticsUser(userId: string | null) {
  distinctId = userId;
}

export function track(name: AnalyticsEventName, props?: Record<string, unknown>) {
  if (!ENABLED || !isAnalyticsEvent(name)) return;
  buffer.push({
    id: randomId(),
    name,
    props: sanitizeEventProps(props),
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
    app_version: appVersion,
    platform: Platform.OS,
  });
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  ensureTimer();
  if (buffer.length >= FLUSH_AT) void flushAnalytics();
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => void flushAnalytics(), FLUSH_INTERVAL_MS);
}

export async function flushAnalytics(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.slice(0, 50);
  try {
    // Only signed-in riders write events; anonymous ones are dropped quietly.
    const { error } = await supabase.rpc('log_app_events', { p_events: batch });
    if (error) throw error;
    buffer = buffer.slice(batch.length);
    if (POSTHOG_KEY) void sendToPostHog(batch);
  } catch {
    // Keep the batch for the next attempt; analytics never blocks the ride.
  } finally {
    flushing = false;
  }
}

async function sendToPostHog(batch: AnalyticsEvent[]) {
  try {
    await fetch(`${POSTHOG_HOST}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        batch: batch.map(e => ({
          event: e.name,
          distinct_id: distinctId ?? e.session_id,
          timestamp: e.occurred_at,
          properties: { ...e.props, $session_id: e.session_id, app_version: e.app_version, platform: e.platform, $process_person_profile: false },
        })),
      }),
    });
  } catch {
    /* best effort */
  }
}

AppState.addEventListener('change', state => {
  if (state === 'background') void flushAnalytics();
});
