export interface User {
  id: string;
  email?: string;
  username: string;
  display_name: string;
  phone?: string;
  emergency_contact?: string;
  avatar_url?: string;
  created_at: string;
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
  status: 'planned' | 'active' | 'completed';
  created_at: string;
}

export interface RideParticipant {
  id: string;
  ride_id: string;
  user_id: string;
  display_name: string;
  is_active: boolean;
  joined_at: string;
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
  type: 'emergency' | 'break' | 'fuel' | 'mechanical';
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
};

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
