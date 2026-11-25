import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import type { PricedProduct } from '@ridentrack/shared';
import { getBillingProvider, onBillingProviderChange } from '../services/billing';

const KEY = 'ridentrack.store_prices';

function phoneRegion(): string | null {
  try {
    return getLocales()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}

/**
 * F19: localised store prices, remembered on the phone so they show at once
 * (and offline) next time, plus the phone's region for the fallback rule.
 */
export function useStorePrices() {
  const [prices, setPrices] = useState<Partial<Record<PricedProduct, string>>>({});
  const [provider, setProvider] = useState(getBillingProvider);
  const [region] = useState(phoneRegion);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(raw => { if (raw) setPrices(p => (Object.keys(p).length ? p : JSON.parse(raw))); })
      .catch(() => {});
  }, []);
  useEffect(() => onBillingProviderChange(() => setProvider(getBillingProvider())), []);
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    provider.prices()
      .then(next => {
        if (cancelled || !Object.keys(next).length) return;
        setPrices(next);
        AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [provider]);

  return { prices, region };
}
