import { useEffect, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from './useAuth';
import { getQueueCounts } from '../lib/offlineQueue';
import { syncQueue } from '../services/syncQueue';
export function useOfflineSync(_rideId?: string) {
  const { user } = useAuth();
  const userId = user?.id;
  const [isOnline, setIsOnline] = useState(false);
  const [counts, setCounts] = useState({ locations: 0, alerts: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const updateCounts = useCallback(async () => { if (userId) setCounts(await getQueueCounts(userId)); }, [userId]);
  const flushQueue = useCallback(async () => {
    if (!userId) return;
    setIsSyncing(true);
    try { await syncQueue(); setSyncError(null); }
    catch (e) { setSyncError(e instanceof Error ? e.message : 'Upload failed; saved locally.'); }
    finally { setIsSyncing(false); await updateCounts().catch(() => setSyncError('Could not read device storage.')); }
  }, [userId, updateCounts]);
  useEffect(() => {
    let online = false;
    const check = () => { if (online) void flushQueue(); else void updateCounts().catch(() => setSyncError('Could not read device storage.')); };
    const unsubscribe = NetInfo.addEventListener(state => { online = Boolean(state.isConnected && state.isInternetReachable !== false); setIsOnline(online); check(); });
    const timer = setInterval(check, 10000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { unsubscribe(); clearInterval(timer); app.remove(); };
  }, [flushQueue, updateCounts]);
  return { isOnline, pendingLocationsCount: counts.locations, pendingAlertsCount: counts.alerts, isSyncing, syncError, updateCounts, flushQueue };
}
