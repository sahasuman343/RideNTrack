/**
 * F20 headset auto-start (Android). When the rider's helmet headset connects
 * over Bluetooth, the phone asks "Start sharing?" for the ride that is about
 * to start. It never starts sharing without a tap: a headset also connects
 * on the commute to work.
 */

export interface HeadsetRide {
  id: string;
  name: string;
  status: string;
  /** YYYY-MM-DD */
  start_date: string | null;
}

export interface HeadsetPromptInput {
  now: number;
  /** Bluetooth device name, e.g. "Cardo PACKTALK". */
  deviceName: string | null;
  /** Names the rider allowed; empty means any audio headset. */
  allowedDevices: string[];
  rides: HeadsetRide[];
  /** Already sharing location on some ride. */
  sharing: boolean;
  /** Last time we asked, to ask at most once in a while. */
  lastPromptAt: number | null;
  /** Local date (YYYY-MM-DD) of `now` in the rider's time zone. */
  todayIso: string;
}

export const HEADSET_PROMPT_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/** Helmet communicators usually say so in their Bluetooth name. */
const HELMET_HINTS = /(cardo|packtalk|freecom|spirit|sena|50s|30k|20s|10s|smh|spider|livall|lexin|fodsports|vimoto|interphone|ejeas|helmet)/i;

export function looksLikeHelmetHeadset(name: string | null | undefined): boolean {
  return !!name && HELMET_HINTS.test(name);
}

/** The ride to offer, or null to stay quiet. */
export function headsetPromptFor(input: HeadsetPromptInput): { ride: HeadsetRide; title: string; body: string } | null {
  if (input.sharing) return null;
  if (input.lastPromptAt != null && input.now - input.lastPromptAt < HEADSET_PROMPT_COOLDOWN_MS) return null;
  const name = (input.deviceName ?? '').trim();
  if (input.allowedDevices.length) {
    if (!input.allowedDevices.some(d => d.trim().toLowerCase() === name.toLowerCase())) return null;
  } else if (!looksLikeHelmetHeadset(name)) {
    return null;
  }
  // An active ride first, then one planned for today.
  const ride = input.rides.find(r => r.status === 'active')
    ?? input.rides.find(r => r.status === 'planned' && r.start_date === input.todayIso);
  if (!ride) return null;
  const active = ride.status === 'active';
  return {
    ride,
    title: active ? `${ride.name} is on. Share your location?` : `Riding ${ride.name} today?`,
    body: active
      ? `${name || 'Your headset'} connected. Tap to open the ride and start sharing.`
      : `${name || 'Your headset'} connected. Tap to open the ride. Nothing is shared until you start.`,
  };
}
