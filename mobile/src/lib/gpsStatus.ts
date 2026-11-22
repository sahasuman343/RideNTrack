import { isStale } from '@ridentrack/shared';

export type TrackerMode = 'waiting' | 'foreground' | 'background' | 'error' | 'paused';

export function gpsStatus(mode: TrackerMode, timestamp: string | undefined, now: number) {
  if (mode === 'paused') return { state: 'paused', label: 'GPS PAUSED' } as const;
  if (mode === 'error') return { state: 'error', label: 'GPS ERROR' } as const;
  if (mode === 'waiting' || !timestamp || !Number.isFinite(Date.parse(timestamp))) {
    return { state: 'waiting', label: 'WAITING FOR GPS' } as const;
  }
  const age = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  return isStale(timestamp, now)
    ? { state: 'stale', label: `GPS STALE (${age}s)` } as const
    : { state: 'fresh', label: `GPS FRESH (${age}s)` } as const;
}
