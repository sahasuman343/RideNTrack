/**
 * Remote feature flags.
 *
 * Every beta, risky screen change and open product decision sits behind a flag
 * so it can be switched per user or per percentage without a store release.
 * The server (get_my_flags) resolves rollout for the signed-in rider; this
 * module merges that answer over safe local defaults.
 */

export const FLAG_DEFAULTS = {
  /** R1: single attention bar on the ride screen. */
  ride_attention_queue: true,
  /** F7: native crash detection countdown. Beta, off until thresholds are tuned. */
  crash_detection_beta: false,
  /** F7-a: hidden sensor recorder for beta builds (consent required). */
  sensor_recorder: false,
  /** Decision 1: store billing via RevenueCat instead of Razorpay checkout for Pro and passes. */
  store_billing: false,
  /** Decision 2: server-side SMS through the configured provider (MSG91 by default). Needs DLT approval. */
  server_sms: false,
  /** Decision 3: family live links and voice notes are free during a live ride (safety stays free). */
  free_safety_features: true,
  /** Decision 4: collect rider phone numbers (opt-in) so SOS can text sweep and captain. */
  rider_phone_numbers: true,
  /** F1: riders near the meetup point are checked in automatically. */
  auto_roll_call: true,
  /** F5: automatic offline map packs on Wi-Fi a week before the trip. */
  offline_map_packs: true,
  /** F11: rider road reports layer. */
  road_reports: true,
  /** F12: push-to-talk voice notes. */
  voice_notes: true,
  /** F13/F18: language picker and following the phone language. Off until a native speaker has reviewed hi.ts. */
  languages: false,
  /** F14: lighter ride screen on 3 GB Android phones. Payload {"tier":"low"} forces a tier. */
  low_end_tuning: true,
  /** F14: sample ride-screen frame rate (no location) into analytics. */
  perf_sampling: false,
  /** F15: clubs. */
  clubs: true,
  /** F17: referral prompts on the spectator page and recap card. */
  referrals: true,
  /** F20: Android headset auto-start prompt (needs the native receiver). */
  headset_autostart: false,
  /** F9: lock-screen emergency card offer. */
  lock_screen_card: true,
} as const;

export type FlagKey = keyof typeof FLAG_DEFAULTS;
export type FlagSet = Record<FlagKey, boolean>;

export interface RemoteFlag {
  key: string;
  enabled: boolean;
  payload?: Record<string, unknown> | null;
}

export function isFlagKey(key: string): key is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, key);
}

/**
 * Remote answers win over defaults; local overrides (a developer menu, or a
 * build-time EXPO_PUBLIC_FLAGS string such as "crash_detection_beta=1") win
 * over both. Unknown keys are ignored so an old app never trips on new flags.
 */
export function resolveFlags(remote: RemoteFlag[] | null | undefined, overrides?: Partial<FlagSet> | null): FlagSet {
  const flags: FlagSet = { ...FLAG_DEFAULTS };
  for (const row of remote ?? []) {
    if (row && typeof row.key === 'string' && isFlagKey(row.key) && typeof row.enabled === 'boolean') {
      flags[row.key] = row.enabled;
    }
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (isFlagKey(key) && typeof value === 'boolean') flags[key] = value;
  }
  return flags;
}

/** Parses "a=1,b=0,c=true" into overrides. */
export function parseFlagOverrides(raw: string | null | undefined): Partial<FlagSet> {
  const out: Partial<FlagSet> = {};
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=').map(x => x?.trim());
    if (!k || !isFlagKey(k)) continue;
    out[k] = v === '1' || v === 'true' || v === 'on';
  }
  return out;
}

/**
 * Deterministic 0–99 bucket for percentage rollouts. Mirrors the SQL in
 * get_my_flags closely enough for tests; the server answer is the source of truth.
 */
export function rolloutBucket(flagKey: string, userId: string): number {
  let h = 2166136261;
  const s = `${flagKey}:${userId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}
