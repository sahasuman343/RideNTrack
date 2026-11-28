/*
 * Waitlist helpers for the waitlist-join Edge Function. Pure TypeScript (Web
 * APIs only), so the Node unit tests cover it.
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const RESEND_URL = 'https://api.resend.com/emails';

/**
 * The caller's IP. cf-connecting-ip is set by the platform's edge and can't be
 * forged; x-forwarded-for's first entry is whatever the caller sent, so it is
 * only a last resort.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  return headers.get('cf-connecting-ip')?.trim()
    || headers.get('x-real-ip')?.trim()
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

/** Salted SHA-256 of the IP, hex. The database only ever sees this, never the IP. */
export async function ipHash(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Asks Cloudflare whether a Turnstile token is genuine. Network trouble counts as a failure. */
export async function verifyTurnstile(token: string, secret: string, ip: string | null, fetchImpl: typeof fetch): Promise<boolean> {
  if (!token || token.length > 2048 || !secret) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
    const body = await res.json().catch(() => null) as { success?: boolean } | null;
    return res.ok && body?.success === true;
  } catch {
    return false;
  }
}

/** The confirmation email. Plain words, one link. */
export function confirmationEmail(input: { to: string; from: string; siteUrl: string; token: string; places: number; months: number }) {
  const link = `${input.siteUrl.replace(/\/+$/, '')}/waitlist/confirm?token=${encodeURIComponent(input.token)}`;
  const text = [
    'Confirm your place on the rideNtrack waitlist:',
    '',
    link,
    '',
    `The first ${input.places} people to confirm get Pro free for ${input.months} months when the app launches.`,
    'The link works for 7 days. If you didn’t ask to join, ignore this email and nothing happens.',
  ].join('\n');
  const html = `<p>Confirm your place on the rideNtrack waitlist:</p>`
    + `<p><a href="${link}">Confirm my email</a></p>`
    + `<p>The first ${input.places} people to confirm get Pro free for ${input.months} months when the app launches.</p>`
    + `<p>The link works for 7 days. If you didn’t ask to join, ignore this email and nothing happens.</p>`;
  return { from: input.from, to: [input.to], subject: 'Confirm your rideNtrack waitlist place', text, html, link };
}

export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
