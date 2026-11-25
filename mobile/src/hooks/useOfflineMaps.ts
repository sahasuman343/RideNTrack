import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { offlineBadge, offlineState, shouldAutoDownload, type LngLat, type OfflinePlan, type OfflineState } from '@ridentrack/shared';
import { downloadTripPacks, getTripPackState, offlineMapsAvailable } from '../services/offlineMaps';
import { track } from '../services/analytics';

/*
 * F5: one badge per trip. Downloads by themselves on Wi-Fi in the week
 * before the trip; on mobile data only when the rider taps the badge.
 */
export function useOfflineMaps(trip: { id: string; start_date?: string | null; route_geometry?: { geometry?: { coordinates?: number[][] } } | null } | null) {
  const coords = useMemo<LngLat[]>(() => (trip?.route_geometry?.geometry?.coordinates ?? []).filter(c => c.length >= 2).map(c => [c[0], c[1]] as LngLat), [trip?.route_geometry]);
  const [onWifi, setOnWifi] = useState(false);
  const [state, setState] = useState<OfflineState | null>(null);
  const [plan, setPlan] = useState<OfflinePlan | null>(null);
  const [packs, setPacks] = useState<Array<{ status: 'complete' | 'active' | 'inactive' | 'error' | 'missing'; percent: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);
  const rideId = trip?.id;

  useEffect(() => NetInfo.addEventListener(s => setOnWifi(s.type === 'wifi' && s.isConnected === true)), []);

  const refresh = useCallback(async () => {
    if (!rideId) return;
    if (!offlineMapsAvailable || coords.length < 2) { setState(coords.length < 2 ? null : 'missing'); return; }
    const st = await getTripPackState(rideId, coords);
    setPlan(st.plan);
    setPacks(st.rows.map(r => ({ status: r.status, percent: r.percent })));
    setState(offlineState(st.rows.map(r => ({ status: r.status, percent: r.percent })), st.plan.boxes.length));
  }, [rideId, coords]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while downloading; progress callbacks also refresh.
  useEffect(() => {
    if (state !== 'downloading') return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [state, refresh]);

  const download = useCallback(async () => {
    if (!rideId || coords.length < 2) return;
    setError(null);
    setState('downloading');
    track('offline_badge_state', { state: 'download_started', wifi: onWifi });
    try {
      await downloadTripPacks(rideId, coords, () => void refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the map.');
    }
    await refresh();
  }, [rideId, coords, onWifi, refresh]);

  useEffect(() => {
    if (autoTried.current || !state || !trip) return;
    if (shouldAutoDownload({ tripStart: trip.start_date, onWifi, state })) {
      autoTried.current = true;
      void download();
    }
  }, [state, onWifi, trip, download]);

  useEffect(() => {
    if (state) track('offline_badge_state', { state });
  }, [state]);

  const badge = state ? offlineBadge(state, packs, plan, onWifi) : null;
  return { state, badge, plan, onWifi, error, download, refresh, available: offlineMapsAvailable };
}
