// Supabase Edge Function: push ride alerts to the rest of the group.
// Invoked by a Database Webhook on INSERT into public.alerts.
// Setup and secrets: docs/push-notifications.md
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Must match mobile/src/services/pushNotifications.ts.
const SOS_CHANNEL_ID = 'sos-alerts';
const RIDE_CHANNEL_ID = 'ride-alerts';
// A non-emergency alert that synced late from an offline queue is no longer actionable.
const MAX_ROUTINE_ALERT_AGE_MS = 10 * 60 * 1000;

// In-memory cache as a fast-path optimization; primary throttle state is stored atomically in PostgreSQL.
const recentAlerts = new Map<string, number>();

function isLocalRateLimited(key: string, minIntervalMs: number): boolean {
  const lastTime = recentAlerts.get(key);
  return typeof lastTime === 'number' && Date.now() - lastTime < minIntervalMs;
}

function recordLocalThrottle(key: string, timestamp: number) {
  recentAlerts.set(key, timestamp);
  if (recentAlerts.size > 1000) {
    const now = Date.now();
    for (const [k, ts] of recentAlerts.entries()) {
      if (now - ts > 60_000) recentAlerts.delete(k);
    }
  }
}

const LABELS: Record<string, string> = {
  emergency: '🚨 SOS',
  break: '☕ Break',
  fuel: '⛽ Fuel stop',
  mechanical: '🔧 Mechanical issue',
  route_deviation: '🧭 Off route',
  rider_behind: '🏍️ Rider behind',
  regroup: '📢 Regroup now',
  announcement: '📢 Captain announcement',
  check_in_missed: '⏱️ Missed check-in',
  possible_crash: '⚠️ Possible crash, confirming',
  crash_cancelled: '✅ Rider is OK',
  crash_detected: '🚨 Crash detected',
};

interface AlertRow {
  id: string;
  ride_id: string;
  user_id: string;
  type: string;
  message: string | null;
  lat: number | null;
  lng: number | null;
  location_recorded_at?: string | null;
  created_at: string;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async req => {
  const secret = Deno.env.get('ALERT_WEBHOOK_SECRET');
  if (!secret || !timingSafeEqual(req.headers.get('x-webhook-secret') ?? '', secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const alert = body?.record as AlertRow | undefined;
  if (body?.type !== 'INSERT' || body?.table !== 'alerts' || !alert?.ride_id || !alert.user_id) {
    return new Response('Ignored', { status: 202 });
  }
  // A missed check-in is as urgent as an SOS: the rider may be down.
  const emergency = alert.type === 'emergency' || alert.type === 'check_in_missed' || alert.type === 'crash_detected';
  const age = Date.now() - Date.parse(alert.created_at);
  if (!emergency && Number.isFinite(age) && age > MAX_ROUTINE_ALERT_AGE_MS) {
    return new Response('Stale alert', { status: 202 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Throttle repeated routine alerts of the SAME type from the same sender.
  // An SOS is never throttled: a rider who just sent "Fuel stop" and then
  // crashes must still reach the group. Webhooks do not retry, so a dropped
  // SOS push would be lost for good.
  if (!emergency) {
    const throttleKey = `${alert.ride_id}:${alert.user_id}:${alert.type}`;
    const throttleInterval = 15_000;
    if (isLocalRateLimited(throttleKey, throttleInterval)) {
      return new Response('Rate limited', { status: 429 });
    }
    const cutoffIso = new Date(Date.now() - throttleInterval).toISOString();
    let query = admin
      .from('alerts')
      .select('id')
      .eq('ride_id', alert.ride_id)
      .eq('user_id', alert.user_id)
      .eq('type', alert.type)
      .neq('id', alert.id)
      .gte('notified_at', cutoffIso);
    // The leader sends one "rider behind" per lagging rider; those carry
    // different coordinates and must not suppress each other.
    if (alert.type === 'rider_behind' && typeof alert.lat === 'number' && typeof alert.lng === 'number') {
      query = query.eq('lat', alert.lat).eq('lng', alert.lng);
    }
    const { data: recentDelivered } = await query.limit(1);
    if (recentDelivered && recentDelivered.length > 0) {
      return new Response('Rate limited', { status: 429 });
    }
  }
  const [ride, sender, members] = await Promise.all([
    admin.from('rides').select('name,status').eq('id', alert.ride_id).maybeSingle(),
    admin.from('profiles').select('display_name').eq('id', alert.user_id).maybeSingle(),
    admin.from('ride_participants').select('user_id').eq('ride_id', alert.ride_id).eq('is_active', true).neq('user_id', alert.user_id),
  ]);
  for (const result of [ride, sender, members]) {
    if (result.error) return new Response(result.error.message, { status: 500 });
  }
  if (!ride.data || ride.data.status === 'completed' || !members.data?.length) {
    return new Response('No recipients', { status: 202 });
  }
  const tokens = await admin.from('push_tokens').select('token').in('user_id', members.data.map(m => m.user_id));
  if (tokens.error) return new Response(tokens.error.message, { status: 500 });
  if (!tokens.data?.length) return new Response('No devices', { status: 202 });

  const riderName = sender.data?.display_name || 'A rider';
  const rideName = ride.data.name;
  const label = LABELS[alert.type] ?? 'Ride alert';
  const fixAgeMs = alert.location_recorded_at ? Date.parse(alert.created_at) - Date.parse(alert.location_recorded_at) : 0;
  const fixAge = Number.isFinite(fixAgeMs) && fixAgeMs > 60_000 ? ` (last known, ${Math.round(fixAgeMs / 60000)} min old)` : '';
  const location = typeof alert.lat === 'number' && typeof alert.lng === 'number'
    ? ` · https://maps.google.com/?q=${alert.lat.toFixed(5)},${alert.lng.toFixed(5)}${fixAge}`
    : emergency ? ' · no GPS fix' : '';
  const detail = alert.message?.trim() || (emergency ? 'needs immediate assistance' : label.replace(/^\S+\s/, ''));
  const messages = tokens.data.map(({ token }) => ({
    to: token,
    title: `${label} · ${riderName}`,
    body: `${detail} (${rideName})${emergency ? location : ''}`,
    data: { rideId: alert.ride_id, alertId: alert.id, type: alert.type },
    channelId: emergency ? SOS_CHANNEL_ID : RIDE_CHANNEL_ID,
    priority: 'high',
    sound: emergency ? 'alert_chime.wav' : 'default',
    ttl: emergency ? 3600 : 600,
  }));

  const stale: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) return new Response(`Expo push failed: ${response.status}`, { status: 502 });
    const result = await response.json().catch(() => null) as { data?: { status: string; details?: { error?: string } }[] } | null;
    result?.data?.forEach((ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') stale.push(chunk[index].to);
    });
  }
  if (stale.length) await admin.from('push_tokens').delete().in('token', stale);

  // Record successful notification delivery in both shared database and local cache
  const deliveryIso = new Date().toISOString();
  await admin.from('alerts').update({ notified_at: deliveryIso }).eq('id', alert.id);
  if (!emergency) recordLocalThrottle(`${alert.ride_id}:${alert.user_id}:${alert.type}`, Date.now());

  return new Response(JSON.stringify({ sent: messages.length, removed: stale.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
