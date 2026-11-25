/**
 * F13 small i18n layer: two locales, plain objects, no runtime dependency, so
 * the same strings work in shared builders (SOS steps, crash countdown), the
 * app and tests.
 */

import { en, type MessageKey } from './locales/en';
import { hi } from './locales/hi';

export type Locale = 'en' | 'hi';
export type { MessageKey };
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const LOCALES: Array<{ code: Locale; name: string; english: string }> = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
];

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, hi };

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'hi';
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

/** Devanagari needs more vertical room than Latin at the same size. */
export function lineHeightFor(locale: Locale, fontSize: number): number {
  return Math.round(fontSize * (locale === 'hi' ? 1.5 : 1.3));
}

export { en as EN_MESSAGES, hi as HI_MESSAGES };
