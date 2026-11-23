import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from './useAuth';
import { getQueueCounts } from '../lib/offlineQueue';
import { syncQueue } from '../services/syncQueue';

type OfflineSync = ReturnType<typeof useOfflineSyncState>;
const OfflineSyncContext = createContext<OfflineSync | null>(null);

/**
 * One app-wide sync loop: breadcrumbs and alerts queued offline must upload
 * when connectivity returns even if the live-ride screen is never reopened.
 */
export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const value = useOfflineSyncState();
  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

export function useOfflineSync() {
  const context = useContext(OfflineSyncContext);
  if (!context) throw new Error('useOfflineSync must be used within OfflineSyncProvider');
  return context;
}

function useOfflineSyncState() {
  const { user } = useAuth();
  const userId = user?.id;
  const [isOnline, setIsOnline] = useState(false);
  const [counts, setCounts] = useState({ locations: 0, alerts: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const updateCounts = useCallback(async () => {
    if (!userId) return;
    const next = await getQueueCounts(userId);
    setCounts(previous => previous.locations === next.locations && previous.alerts === next.alerts ? previous : next);
  }, [userId]);
  const flushQueue = useCallback(async () => {
    if (!userId) return;
    let pending: { locations: number; alerts: number };
    try {
      pending = await getQueueCounts(userId);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Could not read device storage.');
      return;
    }
    setCounts(previous => previous.locations === pending.locations && previous.alerts === pending.alerts ? previous : pending);
    if (pending.locations === 0 && pending.alerts === 0) {
      setSyncError(null);
      return;
    }
    setIsSyncing(true);
    try { await syncQueue(); setSyncError(null); }
    catch (e) { setSyncError(e instanceof Error ? e.message : 'Upload failed; saved locally.'); }
    finally { setIsSyncing(false); await updateCounts().catch(() => setSyncError('Could not read device storage.')); }
  }, [userId, updateCounts]);
  useEffect(() => {
    let online = false;
    const check = () => { if (online) void flushQueue(); else void updateCounts().catch(() => setSyncError('Could not read device storage.')); };
    const unsubscribe = NetInfo.addEventListener(state => { online = Boolean(state.isConnected && state.isInternetReachable !== false); setIsOnline(online); check(); });
    const timer = setInterval(check, 30000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { unsubscribe(); clearInterval(timer); app.remove(); };
  }, [flushQueue, updateCounts]);
  return useMemo(
    () => ({ isOnline, pendingLocationsCount: counts.locations, pendingAlertsCount: counts.alerts, isSyncing, syncError, updateCounts, flushQueue }),
    [isOnline, counts, isSyncing, syncError, updateCounts, flushQueue],
  );
}
