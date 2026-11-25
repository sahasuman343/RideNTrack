import { useEffect, useMemo, useState } from 'react';
import { Alert, Share } from 'react-native';
import { resolveRideEntitlements, type Ride } from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';
import { useFlag } from '../useFeatureFlags';
import { track } from '../../services/analytics';

/*
 * Family spectator links from the live ride screen. With free_safety_features
 * (decision 3) a rider's own family link is free during a ride; otherwise a
 * ride-wide link needs Pro or an Expedition Pass.
 */
export function useSpectatorLinks(params: {
  ride: Ride | null;
  rideId: string;
  userId: string | null | undefined;
  subscriptionTier: string | null | undefined;
  setMessage: (m: string | null) => void;
  onNeedsUpgrade: () => void;
}) {
  const { ride, rideId: id, userId, setMessage, onNeedsUpgrade } = params;
  const [hasActiveSpectatorLink, setHasActiveSpectatorLink] = useState(false);
  const [rideProAccess, setRideProAccess] = useState(false);

  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;
    void supabase.rpc('ride_has_pro_access', { p_ride_id: id }).then(({ data }) => {
      if (!cancelled && typeof data === 'boolean') setRideProAccess(data);
    });
    void supabase
      .from('ride_share_links')
      .select('id')
      .eq('ride_id', id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setHasActiveSpectatorLink(Boolean(data && data.length > 0));
      });
    return () => { cancelled = true; };
  }, [id, userId]);

  const freeSafety = useFlag('free_safety_features');
  const entitlements = useMemo(
    () => resolveRideEntitlements({ userTier: (params.subscriptionTier ?? 'free') as Parameters<typeof resolveRideEntitlements>[0]['userTier'], hasExpeditionPass: rideProAccess }),
    [params.subscriptionTier, rideProAccess],
  );

  async function shareFamilySpectatorLink(hours = 24) {
    if (!ride || !userId) return;
    // Decision 3: during a ride, a rider's own family link is free.
    if (freeSafety) {
      const { data: token, error: linkErr } = await supabase.rpc('create_family_link', { p_ride_id: ride.id });
      if (linkErr || typeof token !== 'string') {
        Alert.alert('Could not create the family link', linkErr?.message ?? 'Please try again.');
        return;
      }
      setHasActiveSpectatorLink(true);
      track('family_update_sent', { via: 'share_sheet' });
      await Share.share({
        title: `${ride.name} · Follow my ride`,
        message: `Follow my ride live on RideNTrack: https://ridentrack.app/track/${token}`,
      });
      return;
    }
    if (!entitlements.limits.supportsSpectatorLink) {
      onNeedsUpgrade();
      return;
    }
    try {
      // The database generates the token (crypto-random); Math.random() on the
      // phone is guessable and this link reveals live rider positions.
      const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      const { data: link, error: linkErr } = await supabase
        .from('ride_share_links')
        .insert({ ride_id: ride.id, created_by: userId, expires_at: expiresAt })
        .select('token')
        .single();
      if (linkErr) throw linkErr;
      const token = (link as { token: string }).token;
      setHasActiveSpectatorLink(true);
      await Share.share({
        title: `${ride.name} · Live Family Link`,
        message: `Track our ride live on RideNTrack: https://ridentrack.app/track/${token}`,
      });
    } catch (e: unknown) {
      Alert.alert('Could not create spectator link', e instanceof Error ? e.message : 'Pro Tourer or Expedition Pass required.');
    }
  }

  async function revokeFamilySpectatorLink() {
    if (!ride) return;
    const { error: revErr } = await supabase
      .from('ride_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('ride_id', ride.id)
      .is('revoked_at', null);
    if (!revErr) {
      setHasActiveSpectatorLink(false);
      setMessage('All active family spectator links revoked.');
    }
    else Alert.alert('Could not turn off the family links', revErr.message);
  }

  return { hasActiveSpectatorLink, rideProAccess, shareFamilySpectatorLink, revokeFamilySpectatorLink };
}
