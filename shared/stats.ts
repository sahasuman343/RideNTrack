/**
 * Live Ride Statistics & Touring Telemetry
 * Pure functions supporting moving/stopped time calculation, speed telemetry,
 * elevation, and pack spread statistics.
 */

import { distanceMeters } from './route';
import { type LocationUpdate, type RiderLiveStatus, getRiderLiveStatus } from './types';

export interface LiveRideStatsInput {
  rideStartTimeMs: number | null;
  currentTimeMs: number;
  accumulatedMovingMs: number;
  lastMovingCheckMs: number | null;
  currentSpeedMps: number | null | undefined;
  distanceCoveredMeters: number;
  maxSpeedKmh: number;
  currentAltitudeMeters?: number | null;
  elevationGainMeters?: number;
  participants: LocationUpdate[];
  currentUserId?: string;
}

export interface PackStatsSummary {
  totalRiders: number;
  ridingCount: number;
  stoppedCount: number;
  disconnectedCount: number;
  packSpreadMeters: number | null;
}

export interface LiveRideStats {
  elapsedTimeMs: number;
  movingTimeMs: number;
  stoppedTimeMs: number;
  currentSpeedKmh: number;
  avgMovingSpeedKmh: number;
  maxSpeedKmh: number;
  distanceCoveredMeters: number;
  currentAltitudeMeters: number | null;
  elevationGainMeters: number;
  packSummary: PackStatsSummary;
  formatted: {
    elapsedTime: string;
    movingTime: string;
    stoppedTime: string;
    distance: string;
    currentSpeed: string;
    avgSpeed: string;
    maxSpeed: string;
    altitude: string;
    packSpread: string;
  };
}

export function filterPlausibleSpeed(speedMps: number | null | undefined): number {
  if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps < 0) return 0;
  const kmh = speedMps * 3.6;
  // Maximum plausible motorcycle touring speed is capped at 220 km/h to prevent GPS jitter spikes
  return Math.min(220, Math.round(kmh * 10) / 10);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function calculatePackSummary(
  participants: LocationUpdate[],
  now = Date.now()
): PackStatsSummary {
  let ridingCount = 0;
  let stoppedCount = 0;
  let disconnectedCount = 0;

  for (const p of participants) {
    const { status } = getRiderLiveStatus(p, undefined, now);
    if (status === 'riding') ridingCount++;
    else if (status === 'stopped') stoppedCount++;
    else if (status === 'disconnected') disconnectedCount++;
  }

  // Calculate pack spread as maximum direct distance between any two active riders
  let maxSpread = 0;
  const validPoints = participants.filter(p => {
    const age = now - Date.parse(p.timestamp);
    return Number.isFinite(age) && age <= 120000 && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  });

  if (validPoints.length >= 2) {
    for (let i = 0; i < validPoints.length; i++) {
      for (let j = i + 1; j < validPoints.length; j++) {
        const d = distanceMeters(validPoints[i], validPoints[j]);
        if (d > maxSpread) maxSpread = d;
      }
    }
  }

  return {
    totalRiders: participants.length,
    ridingCount,
    stoppedCount,
    disconnectedCount,
    packSpreadMeters: validPoints.length >= 2 ? Math.round(maxSpread) : null,
  };
}

export function calculateLiveRideStats(input: LiveRideStatsInput): LiveRideStats {
  const {
    rideStartTimeMs,
    currentTimeMs,
    accumulatedMovingMs,
    currentSpeedMps,
    distanceCoveredMeters,
    maxSpeedKmh,
    currentAltitudeMeters = null,
    elevationGainMeters = 0,
    participants,
  } = input;

  const elapsedTimeMs = rideStartTimeMs ? Math.max(0, currentTimeMs - rideStartTimeMs) : 0;
  const movingTimeMs = Math.min(elapsedTimeMs, Math.max(0, accumulatedMovingMs));
  const stoppedTimeMs = Math.max(0, elapsedTimeMs - movingTimeMs);

  const currentSpeedKmh = filterPlausibleSpeed(currentSpeedMps);
  const updatedMaxSpeed = Math.max(maxSpeedKmh, currentSpeedKmh);

  const movingSeconds = movingTimeMs / 1000;
  const avgMovingSpeedKmh = movingSeconds > 10 && distanceCoveredMeters > 0
    ? Math.round(((distanceCoveredMeters / movingSeconds) * 3.6) * 10) / 10
    : currentSpeedKmh;

  const packSummary = calculatePackSummary(participants, currentTimeMs);

  return {
    elapsedTimeMs,
    movingTimeMs,
    stoppedTimeMs,
    currentSpeedKmh,
    avgMovingSpeedKmh,
    maxSpeedKmh: updatedMaxSpeed,
    distanceCoveredMeters,
    currentAltitudeMeters: currentAltitudeMeters != null && Number.isFinite(currentAltitudeMeters)
      ? Math.round(currentAltitudeMeters)
      : null,
    elevationGainMeters: Math.round(Math.max(0, elevationGainMeters)),
    packSummary,
    formatted: {
      elapsedTime: formatDuration(elapsedTimeMs),
      movingTime: formatDuration(movingTimeMs),
      stoppedTime: formatDuration(stoppedTimeMs),
      distance: formatDistanceMeters(distanceCoveredMeters),
      currentSpeed: `${currentSpeedKmh} km/h`,
      avgSpeed: `${avgMovingSpeedKmh} km/h`,
      maxSpeed: `${updatedMaxSpeed} km/h`,
      altitude: currentAltitudeMeters != null && Number.isFinite(currentAltitudeMeters)
        ? `${Math.round(currentAltitudeMeters)} m`
        : '—',
      packSpread: packSummary.packSpreadMeters != null
        ? formatDistanceMeters(packSummary.packSpreadMeters)
        : 'Single rider',
    },
  };
}
