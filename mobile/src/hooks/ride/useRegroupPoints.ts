import { useCallback, useEffect, useState } from 'react';
import { distanceMeters, type LocationUpdate } from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';

export interface RideRegroupPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  sequence: number;
  my_arrived?: boolean;
  status?: string;
  closed_at?: string;
  total_arrived?: number;
  total_riders?: number;
}

const ARRIVAL_RADIUS_M = 300;

/** Loads the ride's regroup points and works out which one this rider is arriving at. */
export function useRegroupPoints(rideId: string, position: LocationUpdate | null) {
  const [regroupPoints, setRegroupPoints] = useState<RideRegroupPoint[]>([]);
  const [arrivingRegroupPoint, setArrivingRegroupPoint] = useState<{ id: string; name: string } | null>(null);

  const refreshRegroupPoints = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_regroup_points', { p_ride_id: rideId });
    if (!error && Array.isArray(data)) setRegroupPoints(data as RideRegroupPoint[]);
  }, [rideId]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('get_regroup_points', { p_ride_id: rideId }).then(({ data, error }) => {
      if (cancelled) return;
      if (!error && Array.isArray(data)) setRegroupPoints(data as RideRegroupPoint[]);
    });
    return () => { cancelled = true; };
  }, [rideId]);

  useEffect(() => {
    if (!position || regroupPoints.length === 0) {
      setArrivingRegroupPoint(null);
      return;
    }
    const nearest = regroupPoints.find(rp => (!rp.status || rp.status === 'open') && !rp.my_arrived
      && distanceMeters(position, { lat: rp.latitude, lng: rp.longitude }) < ARRIVAL_RADIUS_M);
    setArrivingRegroupPoint(prev => {
      if (!nearest) return null;
      return prev?.id === nearest.id ? prev : { id: nearest.id, name: nearest.name };
    });
  }, [position?.lat, position?.lng, regroupPoints]);

  const confirmArrival = useCallback(async (regroupPointId: string) => {
    const { error: confirmError } = await supabase.rpc('confirm_regroup_arrival', { p_regroup_point_id: regroupPointId });
    if (confirmError) throw confirmError;
    setRegroupPoints(prev => prev.map(p => (p.id === regroupPointId ? { ...p, my_arrived: true } : p)));
    setArrivingRegroupPoint(null);
  }, []);

  const closeRegroupPoint = useCallback(async (pointId: string) => {
    const { error: closeErr } = await supabase.rpc('close_regroup_point', { p_regroup_point_id: pointId });
    if (closeErr) throw closeErr;
    setRegroupPoints(prev => prev.map(p => (p.id === pointId ? { ...p, status: 'closed', closed_at: new Date().toISOString() } : p)));
    setArrivingRegroupPoint(prev => (prev?.id === pointId ? null : prev));
  }, []);

  return { regroupPoints, setRegroupPoints, arrivingRegroupPoint, refreshRegroupPoints, confirmArrival, closeRegroupPoint };
}
