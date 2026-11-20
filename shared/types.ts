export interface User {
  id: string;
  email?: string;
  username: string;
  display_name: string;
  phone?: string;
  emergency_contact?: string;
  avatar_url?: string;
  created_at: string;
  motorcycle_make?: string | null;
  motorcycle_model?: string | null;
  fuel_tank_capacity_liters?: number | null;
  mileage_km_per_liter?: number | null;
  fuel_reserve_liters?: number | null;
  motorcycle_category?: 'adventure' | 'tourer' | 'cruiser' | 'sport' | 'commuter' | 'scooter' | null;
}

export type Profile = User;

export interface Ride {
  id: string;
  name: string;
  ride_code: string;
  admin_id: string;
  origin: string;
  destination: string;
  origin_coords: [number, number]; // [lng, lat]
  destination_coords: [number, number];
  route_geometry?: { type: 'Feature'; geometry: { type: 'LineString'; coordinates: number[][] }; properties: Record<string, unknown> }; // GeoJSON LineString
  status: 'planned' | 'active' | 'completed' | 'archived';
  description?: string | null;
  trip_type?: 'solo' | 'group' | 'weekend' | 'touring' | 'expedition';
  visibility?: 'private' | 'invite_only' | 'public';
  start_date?: string | null;
  end_date?: string | null;
  estimated_distance_meters?: number | null;
  estimated_duration_seconds?: number | null;
  route_deviation_threshold_meters?: number;
  rider_behind_threshold_meters?: number;
  created_at: string;
}

export type TripWaypointType = 'origin' | 'meetup' | 'stop' | 'fuel' | 'food' | 'rest' | 'sightseeing' | 'destination' | 'repair' | 'accommodation';
export interface TripWaypoint {
  id: string;
  ride_id: string;
  sequence: number;
  waypoint_type: TripWaypointType;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  provider_place_id?: string | null;
  notes?: string | null;
  is_optional: boolean;
  planned_arrival?: string | null;
  planned_departure?: string | null;
  trip_day_id?: string | null;
  trip_stage_id?: string | null;
}

export type StageStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';

export interface TripStage {
  id: string;
  ride_id: string;
  trip_day_id?: string | null;
  day_number?: number | null;
  stage_number: number;
  name: string;
  start_name: string;
  destination_name: string;
  start_coords: [number, number];
  destination_coords: [number, number];
  route_geometry?: { type: 'LineString'; coordinates: [number, number][] } | any;
  estimated_distance_meters?: number | null;
  estimated_duration_seconds?: number | null;
  notes?: string | null;
  status: StageStatus;
  created_at: string;
}

export interface TripDay {
  id: string;
  ride_id: string;
  day_number: number;
  trip_date?: string | null;
  title?: string | null;
  notes?: string | null;
}

export interface TripStay {
  id: string;
  ride_id: string;
  trip_day_id?: string | null;
  name: string;
  stay_type: 'hotel' | 'homestay' | 'hostel' | 'camping' | 'guesthouse' | 'other';
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  provider_place_id?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  booking_reference?: string | null;
  price_amount?: number | null;
  price_currency: string;
  contact_phone?: string | null;
  notes?: string | null;
}

export type RideParticipantRole = 'captain' | 'co-captain' | 'marshal' | 'sweeper' | 'member' | 'leader' | 'sweep' | 'rider';
export type RiderConnectionStatus = 'live' | 'stale' | 'offline';

export const ROLE_LABELS: Record<RideParticipantRole, { title: string; icon: string }> = {
  captain: { title: 'Captain', icon: '👑' },
  'co-captain': { title: 'Co-Captain', icon: '🧭' },
  marshal: { title: 'Marshal', icon: '🛡️' },
  sweeper: { title: 'Sweeper', icon: '🧹' },
  member: { title: 'Member', icon: '🏍️' },
  leader: { title: 'Captain', icon: '👑' },
  sweep: { title: 'Sweeper', icon: '🧹' },
  rider: { title: 'Member', icon: '🏍️' },
};

export type TripChecklistCategory = 'bike_inspection' | 'riding_gear' | 'documents' | 'emergency_kit' | 'fuel_tires';

export const CHECKLIST_CATEGORY_LABELS: Record<TripChecklistCategory, { title: string; icon: string }> = {
  fuel_tires: { title: 'Fuel & Tires', icon: '⛽' },
  bike_inspection: { title: 'Motorcycle Inspection', icon: '🔧' },
  riding_gear: { title: 'Riding Gear & Safety', icon: '🪖' },
  documents: { title: 'Essential Documents', icon: '📄' },
  emergency_kit: { title: 'Emergency & Spares', icon: '🩹' },
};

export interface TripChecklistItem {
  id: string;
  category: TripChecklistCategory;
  title: string;
  description?: string | null;
  is_mandatory: boolean;
  sequence: number;
  my_completed: boolean;
  completed_count: number;
}

export interface RideParticipant {
  id: string;
  ride_id: string;
  user_id: string;
  display_name: string;
  role: RideParticipantRole;
  is_active: boolean;
  joined_at: string;
  last_seen?: string | null;
  connection_status?: RiderConnectionStatus;
}

export interface LocationUpdate {
  user_id: string;
  display_name: string;
  lat: number;
  lng: number;
  speed: number; // meters per second; convert only for display
  heading: number; // degrees
  timestamp: string;
}

export interface BufferedLocation {
  id?: string;
  ride_id: string;
  user_id: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: string;
}

export interface Alert {
  id: string;
  ride_id: string;
  user_id: string;
  display_name: string;
  type: 'emergency' | 'break' | 'fuel' | 'mechanical' | 'route_deviation' | 'rider_behind' | 'regroup';
  message?: string;
  lat: number;
  lng: number;
  created_at: string;
  acknowledged_at?: string;
}

export interface BufferedAlert {
  id: string;
  ride_id: string;
  user_id: string;
  type: AlertType;
  message?: string;
  lat: number;
  lng: number;
  created_at: string;
}

export type AlertType = Alert['type'];

export const ALERT_LABELS: Record<AlertType, string> = {
  emergency: '🚨 Emergency',
  break: '☕ Break',
  fuel: '⛽ Fuel Stop',
  mechanical: '🔧 Mechanical Issue',
  route_deviation: '🧭 Route Deviation',
  rider_behind: '🏍️ Rider Behind',
  regroup: '📢 Regroup Now',
};

export type RiderLiveStatus = 'riding' | 'stopped' | 'disconnected' | 'completed';

export function getRiderLiveStatus(
  point: { timestamp: string; speed?: number | null; is_active?: boolean },
  rideStatus?: string,
  now = Date.now()
): { status: RiderLiveStatus; label: string; lastSeenText?: string } {
  if (rideStatus === 'completed' || point.is_active === false) {
    return { status: 'completed', label: 'Completed' };
  }
  const parsedTime = Date.parse(point.timestamp);
  const ageMs = Number.isFinite(parsedTime) ? now - parsedTime : Number.POSITIVE_INFINITY;
  if (ageMs > 120000) { // > 2 minutes
    const lastSeenText = Number.isFinite(parsedTime)
      ? 'Last seen ' + new Date(parsedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'No GPS fix';
    return { status: 'disconnected', label: 'Disconnected', lastSeenText };
  }
  const speedKmh = (point.speed || 0) * 3.6;
  if (speedKmh >= 5) {
    return { status: 'riding', label: 'Riding' };
  }
  return { status: 'stopped', label: 'Stopped' };
}

export interface SyncStatus {
  isOnline: boolean;
  pendingLocationsCount: number;
  pendingAlertsCount: number;
  lastSyncedAt?: string;
}

export function validCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;
}
export function isStale(timestamp: string, now = Date.now()): boolean {
  return !Number.isFinite(Date.parse(timestamp)) || now - Date.parse(timestamp) > 30000;
}
export function mergeLocations(previous: LocationUpdate[], incoming: LocationUpdate[]): LocationUpdate[] {
  const result = new Map(previous.map(p => [p.user_id, p]));
  for (const point of incoming) {
    if (!validCoordinates(point.lat, point.lng) || !Number.isFinite(Date.parse(point.timestamp))) continue;
    const old = result.get(point.user_id);
    if (!old || Date.parse(point.timestamp) >= Date.parse(old.timestamp)) result.set(point.user_id, point);
  }
  return [...result.values()];
}
export function mergeAlerts(previous: Alert[], incoming: Alert[]): Alert[] {
  const result = new Map(previous.map(a => [a.id, a]));
  incoming.forEach(a => result.set(a.id, a));
  return [...result.values()].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 100);
}

export { watchRide, type Connection } from './live';
export { registerAccount, UsernameUnavailableError } from './registration';

export * from './route';


/**
 * Builds a Google Maps directions URL for a motorcycle leg.
 * Omitting the origin lets Google Maps use the device's current location.
 */
export function buildGoogleMapsNavigationUrl(destination: {
  latitude: number;
  longitude: number;
  placeId?: string | null;
}): string {
  if (!validCoordinates(destination.latitude, destination.longitude)) {
    throw new Error('A valid destination coordinate is required for navigation.');
  }
  const params = [
    'api=1',
    'destination=' + encodeURIComponent(destination.latitude + ',' + destination.longitude),
    'travelmode=two-wheeler',
    'dir_action=navigate',
  ];
  if (destination.placeId?.trim()) {
    params.push('destination_place_id=' + encodeURIComponent(destination.placeId.trim()));
  }
  return 'https://www.google.com/maps/dir/?' + params.join('&');
}

export * from './touring';
export * from './journal';
export * from './premium';



