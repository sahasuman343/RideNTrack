import type { Alert, AlertType } from './types';
import type { AttentionItem, AttentionKind } from './attention';

/*
 * Builders that turn ride events into attention items. Kept pure so the
 * wording and the action set are reviewed in one place and unit-tested.
 * Text is plain and short: a rider reads it in under two seconds.
 */

export const RECENT_ALERT_WINDOW_MS = 5 * 60 * 1000;

const ALERT_KIND: Record<AlertType, AttentionKind> = {
  emergency: 'incoming_sos',
  regroup: 'regroup',
  fuel: 'fuel',
  mechanical: 'hazard',
  break: 'info',
  route_deviation: 'info',
  rider_behind: 'info',
  announcement: 'info',
  check_in_missed: 'check_in',
};

const ALERT_TITLE: Record<AlertType, (name: string) => string> = {
  emergency: name => `${name} needs help`,
  regroup: name => `${name}: regroup now`,
  fuel: name => `${name}: fuel stop`,
  mechanical: name => `${name} has a breakdown`,
  break: name => `${name}: break`,
  route_deviation: name => `${name} is off the route`,
  rider_behind: name => `${name}: rider behind`,
  announcement: () => 'Captain announcement',
  check_in_missed: name => `${name} did not answer a check-in`,
};

function minutesBetween(laterIso: string, earlierIso: string): number {
  return Math.round((Date.parse(laterIso) - Date.parse(earlierIso)) / 60000);
}

export function sosLocationSentence(alert: Pick<Alert, 'lat' | 'lng' | 'created_at' | 'location_recorded_at'>): string {
  if (alert.lat == null || alert.lng == null) return 'No GPS fix was available when this was sent.';
  if (alert.location_recorded_at && Date.parse(alert.created_at) - Date.parse(alert.location_recorded_at) > 60_000) {
    return `Location is the last known fix, ${minutesBetween(alert.created_at, alert.location_recorded_at)} min before the alert.`;
  }
  return 'Live location attached.';
}

/** Group alerts from other riders in the last five minutes become attention items. */
export function attentionFromAlerts(
  alerts: Alert[],
  options: { myUserId?: string | null; now?: number; acknowledgedIds?: string[] },
): AttentionItem[] {
  const now = options.now ?? Date.now();
  const acknowledged = new Set(options.acknowledgedIds ?? []);
  const items: AttentionItem[] = [];
  for (const alert of alerts) {
    if (!alert || alert.user_id === options.myUserId) continue;
    const created = Date.parse(alert.created_at);
    if (!Number.isFinite(created) || now - created >= RECENT_ALERT_WINDOW_MS) continue;
    const name = alert.display_name || 'Rider';
    const sweepReport = alert.type === 'regroup' && /^(Sweep passed|All through)/.test(alert.message ?? '');
    const kind: AttentionKind = sweepReport ? 'all_through' : ALERT_KIND[alert.type] ?? 'info';
    const hasLocation = alert.lat != null && alert.lng != null;
    const actions: AttentionItem['actions'] = [];
    let body: string | null = alert.message ? alert.message : null;

    if (alert.type === 'emergency') {
      body = [alert.message, sosLocationSentence(alert)].filter(Boolean).join(' ');
      actions.push({ id: 'escalate', label: 'Call 112', emphasis: 'danger' });
      if (hasLocation) actions.push({ id: 'directions', label: 'Directions', emphasis: 'primary' });
    } else if (alert.type === 'announcement') {
      if (acknowledged.has(alert.id)) continue;
      actions.push({ id: 'ack', label: 'Got it', emphasis: 'primary' });
    }
    if (hasLocation && alert.type !== 'announcement') actions.push({ id: 'focus', label: 'Show on map', emphasis: 'secondary' });

    items.push({
      id: `alert:${alert.id}`,
      kind,
      title: (alert.type === 'announcement' || sweepReport) && alert.message ? alert.message : ALERT_TITLE[alert.type]?.(name) ?? `${name} sent an alert`,
      body: alert.type === 'announcement' ? `From ${name}` : sweepReport ? `From ${name} (sweep)` : body,
      createdAt: alert.created_at,
      expiresAt: new Date(created + RECENT_ALERT_WINDOW_MS).toISOString(),
      actions,
    });
  }
  return items;
}

export function checkInAttention(secondsLeft: number, canTextContact: boolean, nowIso: string): AttentionItem {
  return {
    id: 'check-in',
    kind: 'check_in',
    title: 'Stopped off-route. Are you OK?',
    body: 'If you do not answer, your group gets an alert.',
    createdAt: nowIso,
    countdownSeconds: Math.max(0, Math.round(secondsLeft)),
    sticky: true,
    actions: [
      { id: 'ok', label: "I'm OK", emphasis: 'primary' },
      ...(canTextContact ? [{ id: 'sms', label: 'Text my contact', emphasis: 'danger' as const }] : []),
    ],
  };
}

export function regroupArrivalAttention(point: { id: string; name: string }, nowIso: string, options: { canMarkAllThrough?: boolean } = {}): AttentionItem {
  return {
    id: `regroup:${point.id}`,
    kind: 'regroup',
    title: `Near regroup: ${point.name}`,
    body: options.canMarkAllThrough
      ? 'Confirm your arrival. As sweep, tap All through once the pack has passed.'
      : 'Confirm so the captain knows you are here.',
    createdAt: nowIso,
    actions: [
      { id: 'confirm', label: 'Confirm arrival', emphasis: 'primary' },
      ...(options.canMarkAllThrough ? [{ id: 'all_through', label: 'All through', emphasis: 'secondary' as const }] : []),
    ],
  };
}

export function routeDeviationAttention(meters: number, nowIso: string): AttentionItem {
  return {
    id: 'route-deviation',
    kind: 'info',
    priority: 20,
    title: `About ${meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : Math.round(meters) + ' m'} off the planned route`,
    body: 'Your group has been told. Rejoin the route when it is safe.',
    createdAt: nowIso,
    actions: [{ id: 'navigate', label: 'Navigate back', emphasis: 'secondary' }],
  };
}

export function noticeAttention(id: string, title: string, nowIso: string, options: { body?: string | null; actionLabel?: string; ttlMs?: number } = {}): AttentionItem {
  return {
    id: `notice:${id}`,
    kind: 'info',
    priority: 5,
    title,
    body: options.body ?? null,
    createdAt: nowIso,
    expiresAt: options.ttlMs ? new Date(Date.parse(nowIso) + options.ttlMs).toISOString() : null,
    actions: options.actionLabel ? [{ id: 'retry', label: options.actionLabel, emphasis: 'secondary' }] : [],
  };
}

/** F4: low battery during a ride. Shown once per threshold; the pack is not told. */
export function lowBatteryAttention(levelPercent: number, hoursOfTracking: number, nowIso: string): AttentionItem {
  const critical = levelPercent <= 10;
  return {
    id: `battery:${critical ? 'critical' : 'low'}`,
    kind: 'low_battery',
    title: `Battery ${Math.round(levelPercent)}%`,
    body: critical
      ? 'Plug in now. Your pack loses your position when the phone dies.'
      : `About ${hoursOfTracking} h of tracking left. Plug in at the next stop.`,
    createdAt: nowIso,
    actions: [{ id: 'dismiss_battery', label: 'OK', emphasis: 'secondary' }],
  };
}
