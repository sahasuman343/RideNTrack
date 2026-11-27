/**
 * Facts the marketing pages need that only the operator can supply. Each one is
 * read from a public build-time variable, and a page that needs a missing one
 * says so plainly instead of showing a made-up value.
 */
export const SITE_URL = 'https://ridentrack.app';

function clean(v: string | undefined, pattern: RegExp): string | null {
  const t = (v ?? '').trim();
  return t && pattern.test(t) ? t : null;
}

export const SUPPORT_EMAIL = clean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
export const PLAY_STORE_URL = clean(process.env.NEXT_PUBLIC_PLAY_STORE_URL, /^https:\/\/play\.google\.com\//);
export const APP_STORE_URL = clean(process.env.NEXT_PUBLIC_APP_STORE_URL, /^https:\/\/apps\.apple\.com\//);
/** Legal name of whoever runs rideNtrack, as it should appear in the policies. */
export const OPERATOR_NAME = clean(process.env.NEXT_PUBLIC_OPERATOR_NAME, /^.{2,120}$/);
/** Date the policies were last changed, as YYYY-MM-DD. */
export const POLICY_DATE = clean(process.env.NEXT_PUBLIC_POLICY_DATE, /^\d{4}-\d{2}-\d{2}$/);

export const MARKETING_NAV = [
  { href: '/features', label: 'Features' },
  { href: '/privacy-and-location', label: 'Location data' },
  { href: '/faq', label: 'FAQ' },
  { href: '/download', label: 'Get the app' },
] as const;

export const FOOTER_LINKS = [
  ...MARKETING_NAV,
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms' },
] as const;

export function formatPolicyDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
