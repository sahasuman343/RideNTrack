import type { AttendanceStatus, RideParticipantRole } from '@ridentrack/shared';

/* Row shapes used by the trip workspace and its section components. */
export type Trip = {
  id: string;
  name: string;
  description?: string | null;
  origin: string;
  destination: string;
  origin_coords?: [number, number] | null;
  destination_coords?: [number, number] | null;
  status: string;
  trip_type?: string;
  start_date?: string | null;
  end_date?: string | null;
  estimated_distance_meters?: number | null;
  estimated_duration_seconds?: number | null;
  expense_currency: string;
  ride_code: string;
  admin_id: string;
  route_deviation_threshold_meters: number;
  rider_behind_threshold_meters: number;
  visibility?: 'private' | 'invite_only' | 'public';
  max_participants?: number | null;
  ride_rules?: string | null;
};

export type Waypoint = {
  id: string;
  sequence: number;
  waypoint_type: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  provider_place_id?: string | null;
  notes?: string;
  trip_day_id?: string | null;
};

export type Day = {
  id: string;
  day_number: number;
  trip_date?: string;
  title?: string;
  notes?: string;
};

export type Regroup = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  sequence: number;
  target_arrival: string | null;
  notes: string | null;
  arrived_count: number;
  my_arrived: boolean;
  status?: string;
  closed_at?: string | null;
};

export type RiderFuelSpec = {
  user_id: string;
  display_name: string;
  fuel_tank_capacity_liters: number | string | null;
  mileage_km_per_liter: number | string | null;
  fuel_reserve_liters: number | string | null;
};
export type Rider = {
  user_id: string;
  display_name: string;
  role: RideParticipantRole;
  is_active: boolean;
  last_seen: string | null;
  attendance_status?: AttendanceStatus;
  motorcycle_model?: string;
};

export type Stay = {
  id: string;
  name: string;
  stay_type: string;
  address?: string;
  check_in?: string;
  check_out?: string;
  price_amount?: number;
  price_currency: string;
  trip_day_id?: string | null;
};
