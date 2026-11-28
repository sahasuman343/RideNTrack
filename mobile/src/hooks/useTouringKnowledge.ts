import { useEffect, useMemo, useState } from 'react';
import {
  advisoriesForTrip,
  findFuelGaps,
  matchKnownRoute,
  type RouteAdvisory,
  type RoutePoi,
  type TouringRoute,
} from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { getRideValue, saveRideValue } from '../lib/tripCache';

/*
 * F10: what the curated touring layer knows about this trip, saved on the
 * phone with the trip so it is there in a dead zone.
 */

interface TripKnowledge {
  route: TouringRoute | null;
  pois: RoutePoi[];
  advisories: RouteAdvisory[];
}

const ROUTES_KEY = 'touring-routes';
const tripKey = (rideId: string) => `touring:${rideId}`;

function bbox(line: number[][]) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of line) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const pad = 0.05;
  return { p_min_lng: minLng - pad, p_min_lat: minLat - pad, p_max_lng: maxLng + pad, p_max_lat: maxLat + pad };
}

export function useTouringKnowledge(params: {
  rideId: string | null | undefined;
  routeCoords: number[][] | null | undefined;
  startDate: string | null | undefined;
  packSafeRangeKm: number | null | undefined;
  online: boolean;
}) {
  const { rideId, routeCoords, startDate, packSafeRangeKm, online } = params;
  const [knowledge, setKnowledge] = useState<TripKnowledge | null>(null);
  const routeKey = routeCoords && routeCoords.length > 1
    ? `${routeCoords.length}:${routeCoords[0].join(',')}:${routeCoords[routeCoords.length - 1].join(',')}`
    : '';

  useEffect(() => {
    if (!rideId || !routeKey || !routeCoords) return;
    let cancelled = false;
    void getRideValue<TripKnowledge>(tripKey(rideId)).then(cached => { if (!cancelled && cached) setKnowledge(cached); });
    if (!online) return () => { cancelled = true; };
    void (async () => {
      let routes = await getRideValue<TouringRoute[]>(ROUTES_KEY);
      const fetched = await supabase.from('touring_routes').select('id, name, region, line');
      if (!fetched.error && Array.isArray(fetched.data)) {
        routes = fetched.data as TouringRoute[];
        void saveRideValue(ROUTES_KEY, routes);
      }
      const match = matchKnownRoute(routeCoords, routes ?? []);
      const [poisRes, advRes] = await Promise.all([
        supabase.rpc('get_route_pois_in_bbox', bbox(routeCoords)),
        match ? supabase.from('route_advisories').select('*').eq('route_id', match.route.id) : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled || poisRes.error) return;
      const next: TripKnowledge = {
        route: match?.route ?? null,
        pois: (poisRes.data ?? []) as RoutePoi[],
        advisories: (advRes.data ?? []) as RouteAdvisory[],
      };
      setKnowledge(next);
      void saveRideValue(tripKey(rideId), next);
    })().catch(() => { /* keep the cached copy */ });
    return () => { cancelled = true; };
  }, [rideId, routeKey, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const fuel = useMemo(
    () => (knowledge && routeCoords ? findFuelGaps(routeCoords, knowledge.pois.filter(p => p.kind === 'fuel'), packSafeRangeKm) : null),
    [knowledge, routeKey, packSafeRangeKm], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const advisories = useMemo(() => advisoriesForTrip(knowledge?.advisories ?? [], startDate), [knowledge, startDate]);

  return { route: knowledge?.route ?? null, pois: knowledge?.pois ?? [], fuel, advisories, loaded: knowledge != null };
}
