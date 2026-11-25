/**
 * F13 small i18n layer: two locales, plain objects, no runtime dependency, so
 * the same strings work in shared builders (SOS steps, crash countdown), the
 * app and tests.
 */

import { en, type MessageKey } from './locales/en';
import { hi } from './locales/hi';
import { kn, ml, mr, ta, te, type RegionalCatalog } from './locales/regional';

export type Locale = 'en' | 'hi' | 'ta' | 'kn' | 'ml' | 'te' | 'mr';
export type { MessageKey };
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const LOCALES: Array<{ code: Locale; name: string; english: string }> = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  // F18: safety strings translated, the rest falls back to English.
  { code: 'ta', name: 'தமிழ்', english: 'Tamil' },
  { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ml', name: 'മലയാളം', english: 'Malayalam' },
  { code: 'te', name: 'తెలుగు', english: 'Telugu' },
  { code: 'mr', name: 'मराठी', english: 'Marathi' },
];

const CATALOGS: Record<Locale, RegionalCatalog> = { en, hi, ta, kn, ml, te, mr };

/** Keys every language must have: the words a rider reads in an emergency. */
export const SAFETY_KEY_PREFIXES = ['status.', 'sos.', 'crash.', 'attention.'] as const;

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CATALOGS, v);
}

/** Fill {placeholders}; unknown ones stay visible so a missing variable is noticed. */
export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translator(locale: Locale | null | undefined): Translate {
  const catalog = CATALOGS[locale && isLocale(locale) ? locale : 'en'];
  return (key, vars) => interpolate(catalog[key] ?? en[key] ?? key, vars);
}

/** English by default: the builders in shared/ take an optional translator. */
export const tEn: Translate = translator('en');

/** First supported language in the phone's preference list. */
export function pickLocale(languageTags: Array<string | null | undefined>): Locale {
  for (const tag of languageTags) {
    const code = (tag ?? '').toLowerCase().split(/[-_]/)[0];
    if (isLocale(code)) return code;
  }
  return 'en';
}

/** Indic scripts (Devanagari, Tamil, Kannada, Malayalam, Telugu) need more vertical room than Latin. */
export function lineHeightFor(locale: Locale, fontSize: number): number {
  return Math.round(fontSize * (locale === 'en' ? 1.3 : 1.5));
}

/** BCP 47 tag for text-to-speech (crash prompt). */
export function speechLanguage(locale: Locale): string {
  return `${locale}-IN`;
}

export function catalogFor(locale: Locale): RegionalCatalog {
  return CATALOGS[locale];
}

export { en as EN_MESSAGES, hi as HI_MESSAGES };
export const REGIONAL_MESSAGES = { ta, kn, ml, te, mr };
