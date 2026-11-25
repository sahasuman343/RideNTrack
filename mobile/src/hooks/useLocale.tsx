/**
 * F13: the rider's language. Their own choice wins; otherwise the first
 * supported language in the phone settings. Behind the `languages` flag, so
 * with the flag off everyone sees English.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { isLocale, lineHeightFor, pickLocale, translator, type Locale, type Translate } from '@ridentrack/shared';
import { useFlag } from './useFeatureFlags';
import { track } from '../services/analytics';

const KEY = 'ridentrack.locale';

interface LocaleValue {
  locale: Locale;
  /** null when following the phone. */
  chosen: Locale | null;
  t: Translate;
  setLocale: (next: Locale | null) => void;
  lineHeight: (fontSize: number) => number;
}

const fallback: LocaleValue = {
  locale: 'en',
  chosen: null,
  t: translator('en'),
  setLocale: () => {},
  lineHeight: size => lineHeightFor('en', size),
};

const LocaleContext = createContext<LocaleValue>(fallback);

function phoneLocale(): Locale {
  try {
    return pickLocale(getLocales().map(l => l.languageTag));
  } catch {
    return 'en';
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const enabled = useFlag('languages');
  const [chosen, setChosen] = useState<Locale | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(v => setChosen(isLocale(v) ? v : null))
      .catch(() => {});
  }, []);

  const setLocale = useCallback((next: Locale | null) => {
    setChosen(next);
    track('language_changed', { locale: next ?? 'phone' });
    (next ? AsyncStorage.setItem(KEY, next) : AsyncStorage.removeItem(KEY)).catch(() => {});
  }, []);

  const value = useMemo<LocaleValue>(() => {
    const locale: Locale = enabled ? chosen ?? phoneLocale() : 'en';
    return { locale, chosen, t: translator(locale), setLocale, lineHeight: size => lineHeightFor(locale, size) };
  }, [enabled, chosen, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  return useContext(LocaleContext).t;
}
