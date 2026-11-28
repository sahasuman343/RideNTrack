import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  buildReadiness,
  summariseReadiness,
  type ReadinessFix,
  type ReadinessInput,
  type ReadinessItem,
} from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useFlag } from './useFeatureFlags';
import { registerPushToken } from '../services/pushNotifications';
import { track } from '../services/analytics';

type BatteryModule = typeof import('expo-battery');
let Battery: BatteryModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Battery = require('expo-battery') as BatteryModule;
} catch {
  Battery = null;
}

export interface ReadinessExtras {
  familyContactsCount?: number | null;
  offlineMaps?: ReadinessInput['offlineMaps'];
  offlineMapsDetail?: string | null;
}

interface DeviceState {
  backgroundLocation: boolean | null;
  notifications: boolean | null;
  batteryOptimisationExempt: boolean | null;
}

async function readDeviceState(): Promise<DeviceState> {
  const [bg, notif, battery] = await Promise.all([
    Location.getBackgroundPermissionsAsync().then(r => r.granted).catch(() => null),
    Notifications.getPermissionsAsync().then(r => r.granted).catch(() => null),
    Platform.OS === 'android' && Battery
      ? Battery.isBatteryOptimizationEnabledAsync().then(enabled => !enabled).catch(() => null)
      : Promise.resolve(null),
  ]);
  return { backgroundLocation: bg, notifications: notif, batteryOptimisationExempt: battery };
}

/**
 * Computes this rider's Ride ready list for one trip, refreshes it when the
 * app returns from Settings, and reports the missing ids so the captain sees
 * them on the roster.
 */
export function useRideReadiness(rideId: string | undefined, extras: ReadinessExtras = {}, handlers: Partial<Record<ReadinessFix, () => void>> = {}) {
  const { user, profile, updateProfile } = useAuth();
  const collectPhone = useFlag('rider_phone_numbers');
  const [device, setDevice] = useState<DeviceState>({ backgroundLocation: null, notifications: null, batteryOptimisationExempt: null });
  const lastReported = useRef<string>('');

  const refreshDevice = useCallback(async () => setDevice(await readDeviceState()), []);

  useEffect(() => {
    void refreshDevice();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshDevice();
    });
    return () => sub.remove();
  }, [refreshDevice]);

  const items = useMemo<ReadinessItem[]>(() => buildReadiness({
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    profile: profile ? {
      motorcycle_model: profile.motorcycle_model,
      fuel_tank_capacity_liters: profile.fuel_tank_capacity_liters,
      emergency_contact: profile.emergency_contact,
      phone: profile.phone,
      share_ice_with_ride: profile.share_ice_with_ride,
      blood_group: profile.blood_group,
    } : null,
    familyContactsCount: extras.familyContactsCount,
    offlineMaps: extras.offlineMaps,
    offlineMapsDetail: extras.offlineMapsDetail,
    backgroundLocation: device.backgroundLocation,
    notifications: device.notifications,
    batteryOptimisationExempt: device.batteryOptimisationExempt,
    collectPhone,
    offerFamilyContacts: extras.familyContactsCount !== undefined,
  }), [profile, extras.familyContactsCount, extras.offlineMaps, extras.offlineMapsDetail, device, collectPhone]);

  const summary = useMemo(() => summariseReadiness(items), [items]);

  // Report to the captain only when the answer changes.
  useEffect(() => {
    if (!rideId || !user?.id) return;
    const key = `${rideId}:${summary.ready}:${summary.missingIds.join(',')}`;
    if (key === lastReported.current) return;
    lastReported.current = key;
    void supabase.rpc('report_ride_readiness', { p_ride_id: rideId, p_missing: summary.missingIds, p_ready: summary.ready });
  }, [rideId, user?.id, summary.ready, summary.missingIds]);

  const fix = useCallback(async (item: ReadinessItem) => {
    track('ready_item_fixed', { item: item.id });
    const custom = handlers[item.fix];
    if (custom) { custom(); return; }
    switch (item.fix) {
      case 'request_background_location': {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (!fg.granted) { void Linking.openSettings(); break; }
        const bg = await Location.requestBackgroundPermissionsAsync();
        if (!bg.granted) void Linking.openSettings();
        break;
      }
      case 'request_notifications':
        if (user?.id) await registerPushToken(user.id, { prompt: true }).catch(() => Linking.openSettings());
        break;
      case 'open_battery_settings':
        if (Platform.OS === 'android') {
          await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings());
        } else {
          void Linking.openSettings();
        }
        break;
      case 'toggle_ice_consent':
        await updateProfile({ share_ice_with_ride: true });
        break;
      default:
        break;
    }
    await refreshDevice();
  }, [handlers, user?.id, updateProfile, refreshDevice]);

  return { items, summary, fix, refresh: refreshDevice };
}
