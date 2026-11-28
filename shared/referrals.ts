/**
 * F17 referral loop. Every rider has a short code. It travels in links from
 * the spectator page ("Plan your own ride") and from a finished ride's recap,
 * survives sign-up through the account metadata, and is credited once.
 */

/** No 0/O or 1/I/L: codes get read aloud and typed on a phone. */
export const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 6;

export type ReferralSource = 'spectator' | 'recap' | 'profile' | 'typed';

export function normaliseReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  for (const ch of code) if (!REFERRAL_ALPHABET.includes(ch)) return null;
  return code;
}

/** Pulls a code out of a pasted link (…?ref=ABC123) or a typed code. */
export function referralCodeFrom(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = /[?&]ref=([A-Za-z0-9-]+)/.exec(input);
  return normaliseReferralCode(match ? match[1] : input);
}

export function referralSourceFrom(raw: string | null | undefined): ReferralSource {
  return raw === 'spectator' || raw === 'recap' || raw === 'profile' ? raw : 'typed';
}

export function referralLink(baseUrl: string, code: string, source: ReferralSource): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/register?ref=${encodeURIComponent(code)}&src=${source}`;
}

/** The recap share text: the ride first, the invite second. */
export function referralShareMessage(input: { rideName?: string | null; distanceKm?: number | null; link: string }): string {
  const km = input.distanceKm && input.distanceKm > 0 ? ` (${Math.round(input.distanceKm)} km)` : '';
  const ride = input.rideName ? `Just finished ${input.rideName}${km} with RideNTrack.` : 'I plan and track my group rides with RideNTrack.';
  return `${ride} Plan your own ride: ${input.link}`;
}

export function referralCountText(count: number): string {
  if (count <= 0) return 'Nobody has joined with your link yet.';
  return `${count} rider${count === 1 ? ' has' : 's have'} joined with your link.`;
}
