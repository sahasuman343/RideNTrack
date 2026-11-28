import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { LockScreenCard } from '@ridentrack/shared';

/*
 * F9: the lock-screen emergency card is a setting of this phone, not of the
 * account: it decides what a stranger holding this phone can read. Off by
 * default.
 */

const KEY = '@ridentrack/lock_screen_card';
const listeners = new Set<(on: boolean) => void>();

export async function getLockScreenCardEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setLockScreenCardEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, on ? '1' : '0');
  listeners.forEach(l => l(on));
}

export function useLockScreenCardSetting() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getLockScreenCardEnabled().then(on => { if (!cancelled) setEnabled(on); });
    listeners.add(setEnabled);
    return () => { cancelled = true; listeners.delete(setEnabled); };
  }, []);
  const set = useCallback((on: boolean) => setLockScreenCardEnabled(on), []);
  return [enabled, set] as const;
}

/**
 * iPhone has no ongoing notification without a Live Activity, so post the card
 * once when the ride starts. It stays in Notification Centre on the lock screen.
 */
export async function postRideStartCard(card: LockScreenCard, rideId: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      identifier: `lock-card:${rideId}`,
      content: { title: card.title, body: card.body, sound: false, interruptionLevel: 'passive' },
      trigger: null,
    });
  } catch {
    /* the Medical ID is the real answer on iPhone; this is a convenience */
  }
}

/** Opens the Health app where riders set up Medical ID (shown on the lock screen by iOS itself). */
export function openMedicalIdSetup() {
  void Linking.openURL('x-apple-health://').catch(() => {});
}
