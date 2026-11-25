/**
 * Privacy-first product analytics.
 *
 * Events answer UX questions (do captains finish the flow, where do riders drop
 * out of setup, how often do crash alarms fire falsely). They never carry
 * location, phone numbers, names or free text. sanitizeEventProps enforces that
 * on every platform before anything leaves the phone.
 */

export const ANALYTICS_EVENTS = [
  'app_opened',
  'ride_screen_opened',
  'attention_shown',
  'attention_action',
  'attention_dismissed',
  'alert_sent',
  'sos_state',
  'ready_check_viewed',
  'ready_item_fixed',
  'captain_flow_step',
  'roll_call_completed',
  'ride_started',
  'ride_ended',
  'offline_badge_state',
  'family_update_sent',
  'crash_candidate',
  'crash_false_alarm',
  'crash_escalated',
  'paywall_viewed',
  'purchase_started',
  'purchase_completed',
  'road_report_created',
  'voice_note_sent',
  'language_changed',
  'referral_shared',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsValue = string | number | boolean | null;
export type AnalyticsProps = Record<string, AnalyticsValue>;

const BLOCKED_KEY = /(^|_)(lat|lng|lon|latitude|longitude|coords?|location|position|phone|email|name|body|message|text|note|address|token)(_|$)/i;
const MAX_PROPS = 16;
const MAX_STRING = 64;

export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

/**
 * Drops anything that could identify a place or a person, clips strings and
 * keeps only primitive values. Numbers that look like coordinates are dropped
 * even under an innocent key.
 */
export function sanitizeEventProps(props: Record<string, unknown> | null | undefined): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!props || typeof props !== 'object') return out;
  let count = 0;
  for (const [key, raw] of Object.entries(props)) {
    if (count >= MAX_PROPS) break;
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key) || BLOCKED_KEY.test(key)) continue;
    let value: AnalyticsValue;
    if (raw === null || typeof raw === 'boolean') value = raw;
    else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) continue;
      // A float with 4+ decimals in a coordinate range is almost certainly a position.
      if (Math.abs(raw) <= 180 && !Number.isInteger(raw) && String(raw).split('.')[1]?.length >= 4) continue;
      value = raw;
    } else if (typeof raw === 'string') {
      if (/[0-9]{10,}/.test(raw) || /@/.test(raw)) continue;
      value = raw.slice(0, MAX_STRING);
    } else continue;
    out[key] = value;
    count++;
  }
  return out;
}

export interface AnalyticsEvent {
  id: string;
  name: AnalyticsEventName;
  props: AnalyticsProps;
  occurred_at: string;
  session_id: string;
  app_version?: string | null;
  platform?: string | null;
}
