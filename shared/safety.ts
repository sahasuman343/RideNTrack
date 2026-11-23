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
  latitude: number;
  longitude: number;
  emergencyNote?: string | null;
}

export function formatEmergencySms(payload: EmergencySmsPayload): string {
  const { riderName, motorcycleModel, rideName, latitude, longitude, emergencyNote } = payload;
  const mapsUrl = `https://maps.google.com/?q=${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const bikeInfo = motorcycleModel ? ` riding ${motorcycleModel}` : '';
  const noteInfo = emergencyNote ? ` Note: "${emergencyNote.trim()}".` : '';

  return (
    `EMERGENCY ALERT: ${riderName}${bikeInfo} on trip "${rideName}" requires immediate assistance.` +
    `${noteInfo} Live GPS Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}. Google Maps: ${mapsUrl}`
  );
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
