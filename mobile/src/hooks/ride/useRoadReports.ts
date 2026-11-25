import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LocationUpdate, RoadReport, RoadReportType } from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';
import { enqueueRoadReport, getQueuedRoadReports, newQueueId } from '../../lib/offlineQueue';
import { getRideValue, saveRideValue } from '../../lib/tripCache';

/*
 * F11: road reports around this ride. Reading is a bounding-box RPC around
 * the route (refreshed every two minutes with signal, cached for dead zones);
 * writing goes through the offline queue so a report made in a valley is
 * shared once signal returns.
 */

const REFRESH_MS = 2 * 60 * 1000;
const cacheKey = (rideId: string) => `road-reports:${rideId}`;

function boxAround(coords: number[][] | null | undefined, position: LocationUpdate | null) {
  const pts: number[][] = Array.isArray(coords) && coords.length > 1 ? coords : position ? [[position.lng, position.lat]] : [];
  if (!pts.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const pad = 0.1;
  // The server refuses boxes over 10 degrees; a very long route falls back to the area around the rider.
  if (maxLat - minLat > 9.5 || maxLng - minLng > 9.5) {
    if (!position) return null;
    return { p_min_lng: position.lng - 1, p_min_lat: position.lat - 1, p_max_lng: position.lng + 1, p_max_lat: position.lat + 1 };
  }
  return { p_min_lng: minLng - pad, p_min_lat: minLat - pad, p_max_lng: maxLng + pad, p_max_lat: maxLat + pad };
}

export function useRoadReports(params: {
  enabled: boolean;
  rideId: string | null | undefined;
  userId: string | null | undefined;
  routeCoords: number[][] | null | undefined;
  position: LocationUpdate | null;
  online: boolean;
  pendingCount: number;
  flushQueue: () => Promise<void>;
}) {
  const { enabled, rideId, userId, routeCoords, position, online, pendingCount, flushQueue } = params;
  const [server, setServer] = useState<RoadReport[]>([]);
  const [pending, setPending] = useState<RoadReport[]>([]);
  const [tick, setTick] = useState(0);
  const hasPosition = Boolean(position);
  const routeKey = Array.isArray(routeCoords) ? `${routeCoords.length}:${routeCoords[0]?.join(',')}` : '';

  useEffect(() => {
    if (!enabled || !rideId) return;
    let cancelled = false;
    void getRideValue<RoadReport[]>(cacheKey(rideId)).then(cached => { if (!cancelled && cached && !server.length) setServer(cached); });
    return () => { cancelled = true; };
  }, [enabled, rideId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || !online || !rideId) return;
    const box = boxAround(routeCoords, position);
    if (!box) return;
    let cancelled = false;
    void supabase.rpc('get_road_reports_in_bbox', { ...box, p_ride_id: rideId }).then(({ data, error }) => {
      if (cancelled || error || !Array.isArray(data)) return;
      setServer(data as RoadReport[]);
      void saveRideValue(cacheKey(rideId), data);
    });
    const t = setTimeout(() => setTick(v => v + 1), REFRESH_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [enabled, online, rideId, routeKey, hasPosition, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // My reports still on the phone.
  useEffect(() => {
    if (!enabled || !userId) return;
    void getQueuedRoadReports(userId).then(rows => setPending(rows.filter(r => r.ride_id === rideId).map(r => ({
      id: r.id, type: r.type, lat: r.lat, lng: r.lng, note: r.note, created_at: r.created_at,
      expires_at: new Date(Date.parse(r.created_at) + 48 * 3600_000).toISOString(), confirm_count: 0, mine: true, pending: true,
    })))).catch(() => {});
    if (pendingCount === 0) setTick(v => v + 1);
  }, [enabled, userId, rideId, pendingCount]);

  const report = useCallback(async (type: RoadReportType, note: string | null) => {
    if (!rideId || !userId || !position) return false;
    await enqueueRoadReport({
      id: await newQueueId(), ride_id: rideId, user_id: userId, type,
      lat: position.lat, lng: position.lng, note: note?.trim() ? note.trim().slice(0, 140) : null,
      created_at: new Date().toISOString(),
    });
    void flushQueue().catch(() => {});
    setTick(v => v + 1);
    return true;
  }, [rideId, userId, position, flushQueue]);

  const confirm = useCallback(async (id: string) => {
    if (!online) return;
    const { data } = await supabase.rpc('confirm_road_report', { p_id: id });
    if (typeof data === 'string') {
      setServer(list => list.map(r => (r.id === id ? { ...r, confirmed_by_me: true, confirm_count: r.confirm_count + 1, expires_at: data } : r)));
    }
  }, [online]);

  const hide = useCallback(async (id: string) => {
    if (!rideId) return;
    const { error } = await supabase.rpc('hide_road_report', { p_ride_id: rideId, p_id: id });
    if (!error) setServer(list => list.filter(r => r.id !== id));
  }, [rideId]);

  const reports = useMemo(() => {
    if (!enabled) return [];
    const ids = new Set(server.map(r => r.id));
    return [...server, ...pending.filter(p => !ids.has(p.id))];
  }, [enabled, server, pending]);

  return { reports, report, confirm, hide };
}
