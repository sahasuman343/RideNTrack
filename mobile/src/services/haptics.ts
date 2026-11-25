import { Platform, Vibration } from 'react-native';
import type { HapticPattern } from '@ridentrack/shared';

/*
 * One haptic pattern per attention type, so a rider with the phone in a tank
 * bag can tell an SOS from a fuel nudge without looking. expo-haptics is used
 * where present; plain vibration is the fallback (Expo Go, old Android).
 */

type HapticsModule = typeof import('expo-haptics');
let haptics: HapticsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  haptics = require('expo-haptics') as HapticsModule;
} catch {
  haptics = null;
}

const VIBRATION_FALLBACK: Record<Exclude<HapticPattern, 'none'>, number[]> = {
  sos: [0, 600, 150, 600, 150, 600],
  urgent: [0, 350, 120, 350],
  nudge: [0, 180, 120, 180],
  tick: [0, 60],
  success: [0, 40, 80, 40],
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function impactBurst(count: number, style: 'Heavy' | 'Medium' | 'Light', gapMs: number) {
  if (!haptics) return;
  for (let i = 0; i < count; i++) {
    await haptics.impactAsync(haptics.ImpactFeedbackStyle[style]);
    if (i < count - 1) await wait(gapMs);
  }
}

export async function playHaptic(pattern: HapticPattern): Promise<void> {
  if (pattern === 'none' || Platform.OS === 'web') return;
  try {
    if (!haptics) {
      Vibration.vibrate(VIBRATION_FALLBACK[pattern]);
      return;
    }
    switch (pattern) {
      case 'sos':
        // Long buzz plus three heavy hits: unmistakable through riding gloves.
        Vibration.vibrate(VIBRATION_FALLBACK.sos);
        await impactBurst(3, 'Heavy', 180);
        return;
      case 'urgent':
        await haptics.notificationAsync(haptics.NotificationFeedbackType.Warning);
        await wait(250);
        await haptics.notificationAsync(haptics.NotificationFeedbackType.Warning);
        return;
      case 'nudge':
        await impactBurst(2, 'Medium', 140);
        return;
      case 'tick':
        await haptics.selectionAsync();
        return;
      case 'success':
        await haptics.notificationAsync(haptics.NotificationFeedbackType.Success);
        return;
    }
  } catch {
    /* Haptics are a courtesy; never let them break the ride screen. */
  }
}
