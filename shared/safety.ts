import { distanceToRouteMeters } from './route';

/**
 * Safety & Emergency Coordination Telemetry
 * Pure functions supporting emergency escalation, mechanical breakdown classification,
 * breakdown assistance directories, and crash detection sensor specifications.
 */

import { type MechanicalIssueType, MECHANICAL_ISSUE_LABELS } from './types';

export interface EmergencySmsPayload {
  riderName: string;
  motorcycleModel?: string | null;
  rideName: string;
  /** Null when there is no GPS fix: an SOS must still go out. */
  latitude: number | null;
  longitude: number | null;
  /** Minutes since the fix, when it is not live. */
  locationAgeMinutes?: number | null;
  emergencyNote?: string | null;
}

/** The one SOS text builder, used by every path (composer, check-in, server). */
export function formatEmergencySms(payload: EmergencySmsPayload): string {
  const { riderName, motorcycleModel, rideName, latitude, longitude, emergencyNote, locationAgeMinutes } = payload;
  const bikeInfo = motorcycleModel ? ` riding ${motorcycleModel}` : '';
  const noteInfo = emergencyNote ? ` Note: "${emergencyNote.trim()}".` : '';
  let where: string;
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    where = ' Location: no GPS fix yet; call them.';
  } else {
    const mapsUrl = `https://maps.google.com/?q=${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const label = locationAgeMinutes && locationAgeMinutes >= 2 ? `Last known GPS location (${Math.round(locationAgeMinutes)} min ago)` : 'Live GPS Location';
    where = ` ${label}: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}. Google Maps: ${mapsUrl}`;
  }
  return `EMERGENCY ALERT: ${riderName}${bikeInfo} on trip "${rideName}" requires immediate assistance.${noteInfo}${where}`;
}

export interface MechanicalBreakdownPayload {
  riderName: string;
  issueType: MechanicalIssueType;
  details?: string | null;
  latitude: number;
  longitude: number;
}

export function formatMechanicalBreakdownMessage(payload: MechanicalBreakdownPayload): string {
  const { riderName, issueType, details } = payload;
  const meta = MECHANICAL_ISSUE_LABELS[issueType] || { label: issueType, icon: '🔧' };
  const extra = details?.trim() ? ` — "${details.trim()}"` : '';
  return `Mechanical Issue: ${meta.icon} ${meta.label}${extra} (${riderName})`;
}

/**
 * Crash Detection Specification & Impact Heuristic (Future Research Reference)
 * Identifies high-G impact followed by sudden stop and bike tilt.
 */
export interface CrashSensorTelemetry {
  accelerationG: number; // Combined vector magnitude in Gs (normal riding: 0.8 - 1.5G, impact > 4.5G)
  gyroAngularVelocityDegPerSec: number; // Rotational velocity (spins/flips > 300 deg/s)
  postImpactSpeedKmh: number; // Speed after 15 seconds (stationary < 2 km/h)
  bikeLeanAngleDeg: number; // Bike tilt on ground (> 60 deg)
}

export function evaluateCrashSignature(telemetry: CrashSensorTelemetry): {
  isCandidate: boolean;
  confidence: 'none' | 'low' | 'medium' | 'high';
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  if (telemetry.accelerationG >= 4.5) {
    score += 40;
    reasons.push(`High G impact detected (${telemetry.accelerationG.toFixed(1)}G >= 4.5G)`);
  }
  if (telemetry.gyroAngularVelocityDegPerSec >= 300) {
    score += 25;
    reasons.push(`Rapid rotational velocity (${Math.round(telemetry.gyroAngularVelocityDegPerSec)} deg/s >= 300)`);
  }
  if (telemetry.postImpactSpeedKmh <= 2) {
    score += 20;
    reasons.push(`Sudden post-impact cessation of movement (${telemetry.postImpactSpeedKmh.toFixed(1)} km/h <= 2)`);
  }
  if (telemetry.bikeLeanAngleDeg >= 60) {
    score += 15;
    reasons.push(`Motorcycle horizontal / fallen on side (${Math.round(telemetry.bikeLeanAngleDeg)}° >= 60°)`);
  }

  const confidence = score >= 80 ? 'high' : score >= 50 ? 'medium' : score >= 30 ? 'low' : 'none';
  return {
    isCandidate: score >= 65,
    confidence,
    reasons,
  };
}

export interface NationalHelpline {
  name: string;
  number: string;
  purpose: string;
  icon: string;
}

export const NATIONAL_EMERGENCY_HELPLINES: NationalHelpline[] = [
  { name: 'National Emergency Helpline', number: '112', purpose: 'All-in-one Police, Fire & Medical dispatch', icon: '🚨' },
  { name: 'National Highway Helpline (NHAI)', number: '1033', purpose: '24x7 Highway towing, ambulance & crane', icon: '🛣️' },
  { name: 'Ambulance / Medical Emergency', number: '108', purpose: 'Government Emergency Medical Response', icon: '🚑' },
  { name: 'Police Assistance', number: '100', purpose: 'Local Police Dispatch', icon: '👮' },
];

export interface VerifiedBreakdownService {
  id?: string;
  name: string;
  category: 'mechanic' | 'towing' | 'puncture' | 'fuel' | 'spare_parts' | string;
  region: string;
  phone: string;
  description?: string;
  notes?: string | null;
}

export const SEEDED_BREAKDOWN_DIRECTORY: VerifiedBreakdownService[] = [
  {
    name: 'NHAI 24x7 National Highway Helpline',
    category: 'towing',
    region: 'National Highways, India',
    phone: '1033',
    description: 'Official NHAI emergency assistance for incidents on national highways.',
  },
];

const PLANNED_STOP_TYPES = new Set([
  'fuel',
  'food',
  'rest',
  'accommodation',
  'meetup',
  'destination',
  'stop',
  'repair',
  'sightseeing',
]);

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateStationaryOffRouteCheckIn(params: {
  stationaryDurationMs: number;
  currentLat: number;
  currentLng: number;
  waypoints: Array<{ latitude: number; longitude: number; waypoint_type?: string | null }>;
  minStationaryMs?: number;
  minWaypointDistanceMeters?: number;
  /** Planned route as [lng, lat] pairs. A stop on the route itself is not off-route. */
  routeCoordinates?: number[][] | null;
  minRouteDistanceMeters?: number;
}): { shouldPrompt: boolean; nearestWaypointMeters: number | null; routeDistanceMeters?: number | null } {
  const minStationaryMs = params.minStationaryMs ?? 5 * 60 * 1000;
  const minWaypointDistanceMeters = params.minWaypointDistanceMeters ?? 300;

  if (
    !Number.isFinite(params.currentLat) ||
    !Number.isFinite(params.currentLng) ||
    !Number.isFinite(params.stationaryDurationMs)
  ) {
    return { shouldPrompt: false, nearestWaypointMeters: null };
  }

  let nearest: number | null = null;
  for (const wp of params.waypoints) {
    if (wp.waypoint_type && !PLANNED_STOP_TYPES.has(wp.waypoint_type)) continue;
    if (!Number.isFinite(wp.latitude) || !Number.isFinite(wp.longitude)) continue;
    const dist = haversineMeters(params.currentLat, params.currentLng, wp.latitude, wp.longitude);
    if (nearest === null || dist < nearest) {
      nearest = dist;
    }
  }

  const isStationaryLongEnough = params.stationaryDurationMs >= minStationaryMs;
  const isAwayFromPlannedStop = nearest === null || nearest > minWaypointDistanceMeters;

  // Sparse waypoints are not the route: a rider pulled over on the planned
  // road between two stops is on route. Only prompt when the route geometry
  // (if we have one) also says the rider is away from it.
  let routeDistance: number | null = null;
  const route = params.routeCoordinates;
  if (Array.isArray(route) && route.length >= 2) {
    const d = distanceToRouteMeters({ lat: params.currentLat, lng: params.currentLng }, route);
    if (Number.isFinite(d)) routeDistance = d;
  }
  const minRouteDistanceMeters = params.minRouteDistanceMeters ?? 150;
  const isAwayFromRoute = routeDistance === null || routeDistance > minRouteDistanceMeters;

  return {
    shouldPrompt: isStationaryLongEnough && isAwayFromPlannedStop && isAwayFromRoute,
    nearestWaypointMeters: nearest !== null ? Math.round(nearest) : null,
    routeDistanceMeters: routeDistance !== null ? Math.round(routeDistance) : null,
  };
}
