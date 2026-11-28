/**
 * One status vocabulary for the whole product.
 *
 * "Did my SOS go?" is the worst moment for ambiguity, so the app, the
 * spectator page and family SMS all use these exact words.
 */

export type DeliveryState = 'sending' | 'sent' | 'sent_by_sms' | 'waiting_for_signal' | 'failed';

export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  sending: 'Sending',
  sent: 'Sent',
  sent_by_sms: 'Sent by SMS',
  waiting_for_signal: 'Waiting for signal',
  failed: 'Failed',
};

/** Short text for a tight row, e.g. a chat bubble footer. */
export const DELIVERY_SHORT: Record<DeliveryState, string> = {
  sending: '…',
  sent: 'Sent',
  sent_by_sms: 'SMS',
  waiting_for_signal: 'Waiting',
  failed: 'Failed',
};

export function deliveryLabel(state: DeliveryState, target?: string | null): string {
  const label = DELIVERY_LABELS[state];
  return target ? `${target}: ${label}` : label;
}

/**
 * Collapses several channels into what the rider needs to know. Any channel
 * that reached someone counts as delivered; SMS is named because it changes
 * what the rider should expect next (no app on the other end).
 */
export function combineDelivery(states: DeliveryState[]): DeliveryState {
  if (states.includes('sent')) return 'sent';
  if (states.includes('sent_by_sms')) return 'sent_by_sms';
  if (states.includes('sending')) return 'sending';
  if (states.includes('waiting_for_signal')) return 'waiting_for_signal';
  return states.length ? 'failed' : 'waiting_for_signal';
}

export type RiderPresence = 'live' | 'recent' | 'dead_zone' | 'unknown';

export interface RiderPresenceLabel {
  state: RiderPresence;
  /** "Live", "4 min ago", "In dead zone" */
  label: string;
  /** Longer sentence for families and the spectator page. */
  sentence: string;
  ageMinutes: number | null;
}

export const LIVE_WINDOW_MS = 2 * 60 * 1000;
export const DEAD_ZONE_AFTER_MS = 10 * 60 * 1000;

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest >= 5 && hours < 6 ? `${hours} hr ${rest} min ago` : `${hours} hr ago`;
}

/**
 * Never hide a rider and never show old data as live. After ten minutes
 * without a fix the rider is described as in a dead zone, which is what it
 * almost always is on Indian touring routes, and the age stays visible.
 */
export function riderPresence(
  lastSeenIso: string | null | undefined,
  now: number = Date.now(),
  options: { knownDeadZone?: boolean } = {},
): RiderPresenceLabel {
  const t = lastSeenIso ? Date.parse(lastSeenIso) : NaN;
  if (!Number.isFinite(t)) {
    return { state: 'unknown', label: 'No signal yet', sentence: 'No location received yet.', ageMinutes: null };
  }
  const ageMs = Math.max(0, now - t);
  const minutes = Math.floor(ageMs / 60_000);
  if (ageMs < LIVE_WINDOW_MS) {
    return { state: 'live', label: 'Live', sentence: 'Live now.', ageMinutes: minutes };
  }
  if (ageMs <= DEAD_ZONE_AFTER_MS && !options.knownDeadZone) {
    const age = formatAge(Math.max(1, minutes));
    return { state: 'recent', label: age, sentence: `Last seen ${age}.`, ageMinutes: minutes };
  }
  const age = formatAge(Math.max(1, minutes));
  return {
    state: 'dead_zone',
    label: 'In dead zone',
    sentence: options.knownDeadZone
      ? `Last seen ${age}, in a known no-signal stretch. This is expected.`
      : `Last seen ${age}, probably in a no-signal stretch.`,
    ageMinutes: minutes,
  };
}
