import { useMemo } from 'react';
import {
  calculateDistanceAlongPolyline,
  lastFuelAttention,
  type AttentionItem,
  type LocationUpdate,
  type Profile,
  type Ride,
} from '@ridentrack/shared';
import { useTouringKnowledge } from '../useTouringKnowledge';

/*
 * F10-c: "Last fuel for 180 km" on the live ride, from 5 km before the last
 * station of a long stretch until just after it. Uses the trip's cached
 * touring data, so it works with no signal.
 */
export function useLastFuelWarning(params: {
  ride: Ride | null;
  route: Ride['route_geometry'] | undefined;
  profile: Profile | null;
  position: LocationUpdate | null;
  online: boolean;
  nowIso: string;
}) {
  const { ride, route, profile, position, online, nowIso } = params;
  const coords: number[][] | undefined = route?.geometry?.coordinates;
  const tank = Number(profile?.fuel_tank_capacity_liters) || 0;
  const mileage = Number(profile?.mileage_km_per_liter) || 0;
  const reserve = Number(profile?.fuel_reserve_liters) || 0;
  const myRangeKm = tank > reserve && mileage > 0 ? (tank - reserve) * mileage : null;
  const touring = useTouringKnowledge({ rideId: ride?.id, routeCoords: coords, startDate: ride?.start_date, packSafeRangeKm: myRangeKm, online });

  const item = useMemo<AttentionItem | null>(() => {
    if (!touring.fuel || !position || !coords) return null;
    const along = calculateDistanceAlongPolyline(position, coords);
    if (along.distanceToRouteMeters > 2000) return null;
    return lastFuelAttention(along.distanceAlongRouteMeters / 1000, touring.fuel, nowIso);
  }, [touring.fuel, position?.lat, position?.lng, coords, nowIso]); // eslint-disable-line react-hooks/exhaustive-deps

  const stationFor = (itemId: string) => touring.fuel?.stops.find(s => itemId === `fuel:last:${s.poi.id}`)?.poi ?? null;
  return { item, stationFor };
}
