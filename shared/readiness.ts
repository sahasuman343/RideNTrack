/**
 * Ride ready check.
 *
 * One list of what this rider still needs before this trip, asked in context
 * with a one-tap fix each. It replaces the setup prompts that used to be
 * scattered across the profile, the ride screen and Android banners. Later
 * features add an item here instead of adding their own prompt.
 */

export type ReadinessItemId =
  | 'bike_model'
  | 'emergency_contact'
  | 'phone'
  | 'family_contacts'
  | 'ice_consent'
  | 'offline_maps'
  | 'background_location'
  | 'notifications'
  | 'battery_optimisation';

export type ReadinessStatus = 'ok' | 'missing' | 'unknown' | 'skipped';

/** What tapping the row does. The app maps each to a concrete screen or OS prompt. */
export type ReadinessFix =
  | 'open_bike_picker'
  | 'edit_emergency_contact'
  | 'edit_phone'
  | 'add_family_contact'
  | 'toggle_ice_consent'
  | 'download_offline_maps'
  | 'request_background_location'
  | 'request_notifications'
  | 'open_battery_settings';

export interface ReadinessItem {
  id: ReadinessItemId;
  title: string;
  /** Why it matters, in one sentence the rider can act on. */
  why: string;
  status: ReadinessStatus;
  /** Essential items gate the "Ready" badge; the others are recommendations. */
  essential: boolean;
  fix: ReadinessFix;
  fixLabel: string;
  detail?: string | null;
}

export interface ReadinessInput {
  platform: 'ios' | 'android' | 'web';
  profile: {
    motorcycle_model?: string | null;
    fuel_tank_capacity_liters?: number | null;
    emergency_contact?: string | null;
    phone?: string | null;
    share_ice_with_ride?: boolean | null;
    blood_group?: string | null;
  } | null;
  familyContactsCount?: number | null;
  /** 'ready' | 'partial' | 'missing' | 'not_needed' (no route) | undefined when unknown. */
  offlineMaps?: 'ready' | 'partial' | 'missing' | 'downloading' | 'not_needed' | null;
  offlineMapsDetail?: string | null;
  backgroundLocation?: boolean | null;
  notifications?: boolean | null;
  /** Android only: true when the app is exempt from battery optimisation. null when it cannot be read. */
  batteryOptimisationExempt?: boolean | null;
  /** Decision 4: whether phone numbers are collected at all (flag rider_phone_numbers). */
  collectPhone?: boolean;
  /** F2: whether family updates are offered (needs server SMS or the composer). */
  offerFamilyContacts?: boolean;
}

const has = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

function tri(value: boolean | null | undefined): ReadinessStatus {
  return value === true ? 'ok' : value === false ? 'missing' : 'unknown';
}

export function buildReadiness(input: ReadinessInput): ReadinessItem[] {
  const p = input.profile ?? {};
  const items: ReadinessItem[] = [
    {
      id: 'emergency_contact',
      title: 'Emergency contact',
      why: 'SOS texts and the crash check call this person.',
      status: has(p.emergency_contact) ? 'ok' : 'missing',
      essential: true,
      fix: 'edit_emergency_contact',
      fixLabel: 'Add contact',
    },
    {
      id: 'background_location',
      title: 'Location while the phone is locked',
      why: 'Without it the pack loses you when the screen turns off.',
      status: input.platform === 'web' ? 'skipped' : tri(input.backgroundLocation),
      essential: true,
      fix: 'request_background_location',
      fixLabel: 'Allow',
    },
    {
      id: 'notifications',
      title: 'Ride alerts',
      why: 'SOS and regroup calls reach you in a tank bag.',
      status: input.platform === 'web' ? 'skipped' : tri(input.notifications),
      essential: true,
      fix: 'request_notifications',
      fixLabel: 'Turn on',
    },
    {
      id: 'offline_maps',
      title: 'Ready offline',
      why: 'Maps, route and roster keep working in dead zones.',
      status: input.offlineMaps === 'ready' || input.offlineMaps === 'not_needed'
        ? 'ok'
        : input.offlineMaps == null ? 'unknown' : 'missing',
      essential: true,
      fix: 'download_offline_maps',
      fixLabel: input.offlineMaps === 'downloading' ? 'Downloading…' : 'Download now',
      detail: input.offlineMapsDetail ?? null,
    },
    {
      id: 'bike_model',
      title: 'Your motorcycle',
      why: 'Fuel range and the last-fuel warning use your tank size.',
      status: has(p.motorcycle_model) && (p.fuel_tank_capacity_liters ?? 0) > 0 ? 'ok' : 'missing',
      essential: false,
      fix: 'open_bike_picker',
      fixLabel: 'Pick bike',
    },
    {
      id: 'ice_consent',
      title: 'Share medical info with this ride',
      why: 'Blood group and contact help a stranger help you.',
      status: p.share_ice_with_ride ? 'ok' : 'missing',
      essential: false,
      fix: 'toggle_ice_consent',
      fixLabel: 'Share',
    },
  ];

  if (input.collectPhone !== false) {
    items.splice(1, 0, {
      id: 'phone',
      title: 'Your phone number',
      why: 'Sweep and captain can text you when data is down.',
      status: has(p.phone) ? 'ok' : 'missing',
      essential: false,
      fix: 'edit_phone',
      fixLabel: 'Add number',
    });
  }
  if (input.offerFamilyContacts !== false) {
    items.push({
      id: 'family_contacts',
      title: 'Family updates',
      why: 'Family gets a text when you start, reach the stay, or miss a check.',
      status: (input.familyContactsCount ?? 0) > 0 ? 'ok' : 'missing',
      essential: false,
      fix: 'add_family_contact',
      fixLabel: 'Add family',
    });
  }
  if (input.platform === 'android') {
    items.push({
      id: 'battery_optimisation',
      title: 'Battery optimisation off',
      why: 'Android may stop GPS on long rides otherwise.',
      status: tri(input.batteryOptimisationExempt),
      essential: false,
      fix: 'open_battery_settings',
      fixLabel: 'Open settings',
    });
  }
  return items;
}

export interface ReadinessSummary {
  ready: boolean;
  essentialMissing: number;
  recommendedMissing: number;
  done: number;
  total: number;
  /** The single next thing to fix: essentials first, in list order. */
  next: ReadinessItem | null;
  /** Ids the captain sees on the roster. Unknown device state is not reported as missing. */
  missingIds: ReadinessItemId[];
  headline: string;
}

export function summariseReadiness(items: ReadinessItem[]): ReadinessSummary {
  const counted = items.filter(i => i.status !== 'skipped');
  const missing = counted.filter(i => i.status === 'missing');
  const essentialMissing = missing.filter(i => i.essential).length;
  const done = counted.filter(i => i.status === 'ok').length;
  const next = missing.find(i => i.essential) ?? missing[0] ?? null;
  const ready = essentialMissing === 0;
  const headline = ready
    ? missing.length === 0 ? 'Ride ready' : `Ride ready · ${missing.length} suggestion${missing.length === 1 ? '' : 's'}`
    : `${essentialMissing} thing${essentialMissing === 1 ? '' : 's'} before you ride`;
  return {
    ready,
    essentialMissing,
    recommendedMissing: missing.length - essentialMissing,
    done,
    total: counted.length,
    next,
    missingIds: missing.map(i => i.id),
    headline,
  };
}

export const READINESS_SHORT_LABELS: Record<ReadinessItemId, string> = {
  bike_model: 'Bike',
  emergency_contact: 'Contact',
  phone: 'Phone',
  family_contacts: 'Family',
  ice_consent: 'Medical',
  offline_maps: 'Offline',
  background_location: 'Location',
  notifications: 'Alerts',
  battery_optimisation: 'Battery',
};
