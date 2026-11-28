import type {
  AlertType,
  AttendanceStatus,
  MechanicalIssueType,
  RideParticipantRole,
  RouteWaypointType,
  SavedPlaceCategory,
  TripChecklistCategory,
  TripExpenseCategory,
} from '@ridentrack/shared';
import type { IconName } from './components/ui/Icon';

/*
 * Mobile-side Ionicons for shared domain enums. The shared metadata keeps its emoji `icon`
 * fields for web and stored messages; mobile UI renders these glyphs instead so the app
 * uses one monochrome icon family. Ionicons has no fuel pump or motorcycle, so fuel is a
 * drop and the bike is a speedometer; both always sit next to a text label.
 */

export const WAYPOINT_ICONS: Record<RouteWaypointType, IconName> = {
  origin: 'radio-button-on-outline',
  destination: 'flag-outline',
  stop: 'stop-circle-outline',
  fuel: 'water-outline',
  food: 'restaurant-outline',
  rest: 'cafe-outline',
  sightseeing: 'camera-outline',
  meetup: 'people-outline',
  repair: 'construct-outline',
  accommodation: 'bed-outline',
};

export const SAVED_PLACE_ICONS: Record<SavedPlaceCategory, IconName> = {
  viewpoint: 'camera-outline',
  pass: 'trail-sign-outline',
  fuel: 'water-outline',
  food: 'restaurant-outline',
  stay: 'bed-outline',
  repair: 'construct-outline',
  other: 'location-outline',
};

export const ROLE_ICONS: Record<RideParticipantRole, IconName> = {
  captain: 'ribbon-outline',
  leader: 'ribbon-outline',
  'co-captain': 'compass-outline',
  marshal: 'shield-outline',
  sweeper: 'return-down-back-outline',
  sweep: 'return-down-back-outline',
  member: 'speedometer-outline',
  rider: 'speedometer-outline',
};

export const CHECKLIST_ICONS: Record<TripChecklistCategory, IconName> = {
  fuel_tires: 'water-outline',
  bike_inspection: 'construct-outline',
  riding_gear: 'shield-checkmark-outline',
  documents: 'document-text-outline',
  emergency_kit: 'medkit-outline',
};

export const EXPENSE_ICONS: Record<TripExpenseCategory, IconName> = {
  fuel: 'water-outline',
  food: 'restaurant-outline',
  stay: 'bed-outline',
  toll: 'ticket-outline',
  repairs: 'construct-outline',
  other: 'card-outline',
};

export const ATTENDANCE_ICONS: Record<AttendanceStatus, IconName> = {
  confirmed: 'checkmark-circle-outline',
  tentative: 'help-circle-outline',
  declined: 'close-circle-outline',
  attended: 'flag-outline',
};

export const ALERT_ICONS: Record<AlertType, IconName> = {
  emergency: 'warning-outline',
  break: 'cafe-outline',
  fuel: 'water-outline',
  mechanical: 'construct-outline',
  route_deviation: 'navigate-outline',
  rider_behind: 'speedometer-outline',
  regroup: 'people-outline',
  announcement: 'megaphone-outline',
  check_in_missed: 'time-outline',
  possible_crash: 'warning-outline',
  crash_cancelled: 'checkmark-circle-outline',
  crash_detected: 'medkit-outline',
};

export const MECHANICAL_ICONS: Record<MechanicalIssueType, IconName> = {
  puncture: 'disc-outline',
  clutch_cable: 'git-commit-outline',
  chain: 'link-outline',
  battery: 'battery-dead-outline',
  fuel_empty: 'water-outline',
  engine: 'thermometer-outline',
  accident: 'warning-outline',
  other: 'construct-outline',
};

/** Open-Meteo WMO weather code → glyph; mirrors the bands in shared getWeatherConditionFromCode. */
export function weatherIcon(code: number): IconName {
  if (code === 0) return 'sunny-outline';
  if (code === 1 || code === 2) return 'partly-sunny-outline';
  if (code === 3 || code === 45 || code === 48) return 'cloudy-outline';
  if (code >= 71 && code <= 77) return 'snow-outline';
  if (code >= 95) return 'thunderstorm-outline';
  if (code >= 51 && code <= 82) return 'rainy-outline';
  return 'thermometer-outline';
}

const EMOJI_PREFIX = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u;

/** Shared labels such as ALERT_LABELS start with an emoji; strip it when an Icon is rendered alongside. */
export function plainLabel(label: string): string {
  return label.replace(EMOJI_PREFIX, '');
}
