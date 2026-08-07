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
  route_geometry?: any; // GeoJSON LineString
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
  speed: number; // m/s or km/h
  heading: number; // degrees
  timestamp: string;
}

export interface BufferedLocation {
  id?: number;
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
