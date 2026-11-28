import { useEffect, useState } from 'react';

/*
 * F4: battery level (0-100) and charging state via expo-battery. Loaded with
 * require so web and tests without the native module just get null.
 */
type BatteryModule = typeof import('expo-battery');
let mod: BatteryModule | null = null;
try { mod = require('expo-battery') as BatteryModule; } catch { mod = null; }

export function useBatteryLevel(): { levelPercent: number | null; charging: boolean } {
  const [levelPercent, setLevel] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);

  useEffect(() => {
    const battery = mod;
    if (!battery) return;
    let cancelled = false;
    void battery.getBatteryLevelAsync().then(l => { if (!cancelled && l >= 0) setLevel(Math.round(l * 100)); }).catch(() => {});
    void battery.getBatteryStateAsync().then(st => {
      if (!cancelled) setCharging(st === battery.BatteryState.CHARGING || st === battery.BatteryState.FULL);
    }).catch(() => {});
    const levelSub = battery.addBatteryLevelListener(({ batteryLevel }) => { if (batteryLevel >= 0) setLevel(Math.round(batteryLevel * 100)); });
    const stateSub = battery.addBatteryStateListener(({ batteryState }) => {
      setCharging(batteryState === battery.BatteryState.CHARGING || batteryState === battery.BatteryState.FULL);
    });
    return () => { cancelled = true; levelSub.remove(); stateSub.remove(); };
  }, []);

  return { levelPercent, charging };
}
