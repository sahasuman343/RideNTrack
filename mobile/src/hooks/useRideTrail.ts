import { useEffect, useMemo, useState } from 'react';
import {
  EMPTY_TRAIL,
  appendTrailPoint,
  mergeTrailHistory,
  type LocationUpdate,
  type RideTrail,
  type TrailHistory,
} from '@ridentrack/shared';
import { supabase } from '../lib/supabase';

/** Owns persisted-history loading and incremental trail accumulation. */
export function useRideTrail(rideId: string, userId?: string, position?: LocationUpdate | null) {
  const [trail, setTrail] = useState<RideTrail>(EMPTY_TRAIL);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!rideId || !userId) { setTrail(EMPTY_TRAIL); return; }
    let cancelled = false;
    setTrail(EMPTY_TRAIL);
    setLoadError(null);
    void supabase.rpc('get_my_ride_trail', { p_ride_id: rideId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setLoadError(error.message); return; }
      if (data) setTrail(live => mergeTrailHistory(data as TrailHistory, live));
    });
    return () => { cancelled = true; };
  }, [rideId, userId]);

  useEffect(() => {
    if (position && Number.isFinite(position.lng) && Number.isFinite(position.lat)) {
      setTrail(previous => appendTrailPoint(previous, position));
    }
  }, [position]);

  const geoJson = useMemo(() => trail.coords.length < 2 ? null : {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: trail.coords },
    properties: {},
  }, [trail.coords]);

  return { geoJson, distanceMeters: Math.round(trail.distanceMeters), loadError };
}
