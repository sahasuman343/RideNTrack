import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FLAG_DEFAULTS, parseFlagOverrides, resolveFlags, type FlagKey, type FlagSet, type RemoteFlag } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';

/*
 * Remote feature flags. The last answer from get_my_flags is cached so a rider
 * starting a ride in a dead zone still gets the flags they had yesterday.
 */

const CACHE_KEY = '@ridentrack/flags';
const buildOverrides = parseFlagOverrides(process.env.EXPO_PUBLIC_FLAGS);

interface FlagsContextValue {
  flags: FlagSet;
  /** Remote payloads by flag key, e.g. tuned crash thresholds. */
  payloads: Partial<Record<FlagKey, Record<string, unknown>>>;
  refreshFlags: () => Promise<void>;
}

function payloadsOf(remote: RemoteFlag[] | null): FlagsContextValue['payloads'] {
  const out: FlagsContextValue['payloads'] = {};
  for (const f of remote ?? []) {
    if (f && f.payload && typeof f.payload === 'object' && Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, f.key)) {
      out[f.key as FlagKey] = f.payload;
    }
  }
  return out;
}

const FlagsContext = createContext<FlagsContextValue>({
  flags: resolveFlags(null, buildOverrides),
  payloads: {},
  refreshFlags: async () => {},
});

export function FeatureFlagsProvider({ userId, children }: { userId: string | null | undefined; children: React.ReactNode }) {
  const [flags, setFlags] = useState<FlagSet>(() => resolveFlags(null, buildOverrides));
  const [payloads, setPayloads] = useState<FlagsContextValue['payloads']>({});

  const refreshFlags = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc('get_my_flags');
    if (error || !Array.isArray(data)) return;
    const remote = data as RemoteFlag[];
    setFlags(resolveFlags(remote, buildOverrides));
    setPayloads(payloadsOf(remote));
    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(remote)).catch(() => {});
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(CACHE_KEY).then(raw => {
      if (cancelled || !raw) return;
      try {
        const cached = JSON.parse(raw) as RemoteFlag[];
        setFlags(resolveFlags(cached, buildOverrides));
        setPayloads(payloadsOf(cached));
      } catch { /* ignore bad cache */ }
    }).catch(() => {});
    void refreshFlags();
    return () => { cancelled = true; };
  }, [refreshFlags]);

  return <FlagsContext.Provider value={{ flags, payloads, refreshFlags }}>{children}</FlagsContext.Provider>;
}

export function useFeatureFlags() {
  return useContext(FlagsContext);
}

export function useFlag(key: FlagKey): boolean {
  return useContext(FlagsContext).flags[key] ?? FLAG_DEFAULTS[key];
}

export function useFlagPayload(key: FlagKey): Record<string, unknown> | null {
  return useContext(FlagsContext).payloads[key] ?? null;
}
