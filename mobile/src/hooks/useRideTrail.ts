import { useEffect, useMemo, useState } from 'react';
import {
  EMPTY_TRAIL,
  MAX_TRAIL_POINTS,
  appendTrailPoint,
  mergeTrailHistory,
  type LocationUpdate,
  type RideTrail,
  type TrailHistory,
} from '@ridentrack/shared';
import { supabase } from '../lib/supabase';

/** Owns persisted-history loading and incremental trail accumulation. */
/** F14: low-end phones keep fewer trail points on the map; distance is unaffected. */
export function useRideTrail(rideId: string, userId?: string, position?: LocationUpdate | null, maxPoints = MAX_TRAIL_POINTS) {
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
      if (data) setTrail(live => mergeTrailHistory(data as TrailHistory, live, maxPoints));
    });
    return () => { cancelled = true; };
  }, [rideId, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (position && Number.isFinite(position.lng) && Number.isFinite(position.lat)) {
      setTrail(previous => appendTrailPoint(previous, position, maxPoints));
    }
  }, [position, maxPoints]);

  const geoJson = useMemo(() => trail.coords.length < 2 ? null : {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: trail.coords },
    properties: {},
  }, [trail.coords]);

  return { geoJson, distanceMeters: Math.round(trail.distanceMeters), loadError };
}
