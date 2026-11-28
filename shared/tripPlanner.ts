/**
 * Trip planning helpers shared by the web planner (and available to mobile):
 * place search, trip day generation, and the create_trip_plan payload.
 */

export type TripPlanType = 'solo' | 'group' | 'weekend' | 'touring' | 'expedition';

export const TRIP_TYPE_LABELS: Record<TripPlanType, string> = {
  solo: 'Solo ride',
  group: 'Group ride',
  weekend: 'Weekend getaway',
  touring: 'Touring',
  expedition: 'Expedition',
};

export const TRIP_VISIBILITY_LABELS: Record<'private' | 'invite_only' | 'public', string> = {
  private: 'Private',
  invite_only: 'Invite only',
  public: 'Public',
};

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  longitude: number;
  latitude: number;
}

/** The server accepts at most 31 trip days. */
export const MAX_TRIP_DAYS = 31;

/** Every calendar date from start to end inclusive (YYYY-MM-DD), capped at 31. */
export function tripDates(startDate: string | null | undefined, endDate: string | null | undefined): string[] {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!startDate || !endDate || !ymd.test(startDate) || !ymd.test(endDate)) return [];
  const start = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const result: string[] = [];
  for (let d = new Date(start); d <= end && result.length < MAX_TRIP_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

/** Turns a Mapbox geocoding response into unique, valid places. */
export function parsePlaceResults(payload: unknown): PlaceResult[] {
  const features = (payload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const results: PlaceResult[] = [];
  for (const raw of features) {
    const item = raw as { id?: unknown; text?: unknown; place_name?: unknown; center?: unknown };
    if (!Array.isArray(item.center) || item.center.length < 2) continue;
    const longitude = Number(item.center[0]);
    const latitude = Number(item.center[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const id = String(item.id ?? item.place_name ?? `${longitude},${latitude}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const name = typeof item.text === 'string' && item.text ? item.text : typeof item.place_name === 'string' && item.place_name ? item.place_name : 'Unnamed place';
    const address = typeof item.place_name === 'string' && item.place_name ? item.place_name : name;
    results.push({ id, name, address, longitude, latitude });
  }
  return results;
}

/** Searches Indian places with Mapbox geocoding, like the mobile trip form. */
export async function searchPlaces(
  query: string,
  { token, proximity, signal }: { token: string; proximity?: [number, number] | null; signal?: AbortSignal },
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const params = new URLSearchParams({
    autocomplete: 'true',
    fuzzyMatch: 'true',
    limit: '8',
    country: 'IN',
    language: 'en',
    worldview: 'in',
    types: 'poi,address,place,locality,neighborhood,postcode,region',
    access_token: token,
  });
  if (proximity) params.set('proximity', proximity.join(','));
  const response = await fetch(
    'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(trimmed) + '.json?' + params.toString(),
    { signal },
  );
  if (!response.ok) throw new Error('Search is temporarily unavailable. Please try again.');
  return parsePlaceResults(await response.json());
}

export interface TripPlanDraft {
  name: string;
  description?: string;
  tripType: TripPlanType;
  startDate?: string;
  endDate?: string;
  origin: PlaceResult | null;
  destination: PlaceResult | null;
  stops: Array<{ place: PlaceResult | null; kind: 'stop' | 'fuel' | 'food' | 'rest' | 'sightseeing' | 'meetup' }>;
}

/** Checks a draft before it is sent; returns a rider-facing message or null. */
export function validateTripPlanDraft(draft: TripPlanDraft, maxRoutePoints: number): string | null {
  if (!draft.name.trim()) return 'Give your trip a name.';
  if (!draft.origin) return 'Choose where the trip starts.';
  if (!draft.destination) return 'Choose where the trip ends.';
  if (draft.stops.some(s => !s.place)) return 'Pick a place for every stop, or remove the empty one.';
  const points = 2 + draft.stops.length;
  if (points > maxRoutePoints) return `Your plan allows up to ${maxRoutePoints} route points, including start and end.`;
  if ((draft.startDate && !draft.endDate) || (!draft.startDate && draft.endDate)) return 'Add both a start and an end date, or leave both empty.';
  if (draft.startDate && draft.endDate && tripDates(draft.startDate, draft.endDate).length === 0) return 'The end date must be on or after the start date.';
  return null;
}

/** Arguments for the create_trip_plan RPC (same shape the mobile app sends). */
export function buildCreateTripPlanArgs(
  draft: TripPlanDraft,
  route: { geometry: { type: 'LineString'; coordinates: number[][] }; distance: number; duration: number } | null,
) {
  if (!draft.origin || !draft.destination) throw new Error('Trip needs a start and an end.');
  const ordered = [
    { place: draft.origin, type: 'origin' },
    ...draft.stops.map(s => ({ place: s.place as PlaceResult, type: s.kind as string })),
    { place: draft.destination, type: 'destination' },
  ];
  return {
    p_trip: {
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      trip_type: draft.tripType,
      visibility: 'invite_only',
      start_date: draft.startDate || null,
      end_date: draft.endDate || null,
      origin: draft.origin.address,
      destination: draft.destination.address,
      origin_coords: [draft.origin.longitude, draft.origin.latitude],
      destination_coords: [draft.destination.longitude, draft.destination.latitude],
      route_geometry: route ? { type: 'Feature', geometry: route.geometry, properties: {} } : null,
      estimated_distance_meters: route?.distance ?? null,
      estimated_duration_seconds: route?.duration ?? null,
    },
    p_waypoints: ordered.map((item, index) => ({
      sequence: index,
      waypoint_type: item.type,
      name: item.place.name,
      address: item.place.address,
      latitude: item.place.latitude,
      longitude: item.place.longitude,
      provider_place_id: item.place.id,
    })),
    p_days: tripDates(draft.startDate, draft.endDate).map((date, index) => ({
      day_number: index + 1,
      trip_date: date,
      title: 'Day ' + (index + 1),
    })),
    p_stay: null,
  };
}
