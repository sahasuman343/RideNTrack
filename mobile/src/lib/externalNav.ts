import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import {
  buildExternalNavUrl,
  sliceNavigationLegs,
  type ExternalNavProvider,
  type RoutePoint,
} from '@ridentrack/shared';

const NAV_PROVIDER_STORAGE_KEY = 'ridentrack:preferred_nav_provider';

export function getDefaultNavProvider(): ExternalNavProvider {
  return Platform.OS === 'ios' ? 'apple_maps' : 'google_maps';
}

export async function getPreferredNavProvider(): Promise<ExternalNavProvider> {
  try {
    const stored = await AsyncStorage.getItem(NAV_PROVIDER_STORAGE_KEY);
    if (stored === 'google_maps' || stored === 'apple_maps') {
      return stored;
    }
  } catch {
    // Ignore storage read errors and fall back to platform default.
  }
  return getDefaultNavProvider();
}

export async function setPreferredNavProvider(provider: ExternalNavProvider): Promise<void> {
  try {
    await AsyncStorage.setItem(NAV_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // Ignore storage write errors.
  }
}

export function formatNavProviderLabel(provider: ExternalNavProvider): string {
  return provider === 'apple_maps' ? 'Apple Maps' : 'Google Maps';
}

export async function openExternalNavLeg(
  points: RoutePoint[],
  preferredProvider?: ExternalNavProvider,
  options?: { avoidTolls?: boolean; legIndex?: number },
): Promise<{ provider: ExternalNavProvider; legCount: number; legIndex: number }> {
  const provider = preferredProvider ?? (await getPreferredNavProvider());
  const legs = sliceNavigationLegs(points);
  const legIndex = Math.max(0, Math.min(options?.legIndex ?? 0, legs.length - 1));
  const targetLeg = legs[legIndex];
  const url = buildExternalNavUrl(provider, targetLeg, { avoidTolls: options?.avoidTolls });

  const canOpen = await Linking.canOpenURL(url).catch(() => true);
  if (canOpen) {
    await Linking.openURL(url);
    return { provider, legCount: legs.length, legIndex };
  }

  const fallback: ExternalNavProvider = provider === 'apple_maps' ? 'google_maps' : 'apple_maps';
  const fallbackUrl = buildExternalNavUrl(fallback, targetLeg, { avoidTolls: options?.avoidTolls });
  await Linking.openURL(fallbackUrl);
  return { provider: fallback, legCount: legs.length, legIndex };
}
