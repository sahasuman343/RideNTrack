import { useCallback, useEffect, useState } from 'react';
import { Share } from 'react-native';
import { referralLink, referralShareMessage, type ReferralSource } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useFlag } from './useFeatureFlags';
import { track } from '../services/analytics';

const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL || 'https://ridentrack.app';

/** F17: the rider's invite code, how many joined with it, and a share action. */
export function useReferral() {
  const { user } = useAuth();
  const enabled = useFlag('referrals');
  const [code, setCode] = useState<string | null>(null);
  const [joined, setJoined] = useState(0);

  useEffect(() => {
    if (!enabled || !user) return;
    let cancelled = false;
    void (async () => {
      const [{ data: c }, { data: n }] = await Promise.all([
        supabase.rpc('get_my_referral_code'),
        supabase.rpc('get_my_referral_count'),
      ]);
      if (cancelled) return;
      if (typeof c === 'string') setCode(c);
      if (typeof n === 'number') setJoined(n);
    })();
    return () => { cancelled = true; };
  }, [enabled, user]);

  const share = useCallback(async (source: ReferralSource, ride?: { name?: string | null; distanceKm?: number | null }) => {
    const link = code ? referralLink(WEB_BASE, code, source) : `${WEB_BASE}/register`;
    const message = referralShareMessage({ rideName: ride?.name, distanceKm: ride?.distanceKm, link });
    const result = await Share.share({ message });
    if (result.action === Share.sharedAction) track('referral_shared', { source });
  }, [code]);

  return { enabled: enabled && Boolean(user), code, joined, share };
}
