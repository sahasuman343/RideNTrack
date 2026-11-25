/*
 * F1 Guided captain flow. The captain confirms, the app does the counting.
 * Pure logic: which step the captain is on, who is checked in by location,
 * whether the ride can start, who is missing at a regroup, and the generated
 * debrief. The database enforces the same rules (migration 20261201000600).
 */

export type CaptainPhase = 'briefing' | 'roll_call' | 'riding' | 'debrief' | 'done';

export const AUTO_CHECK_IN_RADIUS_M = 200;
export const AUTO_CHECK_IN_MAX_FIX_AGE_MS = 5 * 60 * 1000;
export const AUTO_CHECK_IN_MAX_ACCURACY_M = 100;

export type RollCallStatus = 'checked_in' | 'absent' | 'waiting';
export type CheckInSource = 'location' | 'captain' | 'self' | null;

export interface RollCallRider {
  userId: string;
  name: string;
  role?: string | null;
  /** Server attendance_status. */
  attendance?: string | null;
  checkedInBy?: CheckInSource;
}

export interface CaptainFlowInput {
  rideStatus: 'planned' | 'active' | 'completed' | string;
  briefingVersion: number | null;
  debriefSaved: boolean;
}

export function captainPhase({ rideStatus, briefingVersion, debriefSaved }: CaptainFlowInput): CaptainPhase {
  if (rideStatus === 'completed') return debriefSaved ? 'done' : 'debrief';
  if (rideStatus === 'active') return 'riding';
  return briefingVersion ? 'roll_call' : 'briefing';
}

export const CAPTAIN_PHASE_LABELS: Record<CaptainPhase, { step: string; title: string; action: string }> = {
  briefing: { step: 'Step 1 of 3', title: 'Brief the pack', action: 'Share briefing' },
  roll_call: { step: 'Step 2 of 3', title: 'Roll call', action: 'Start ride' },
  riding: { step: 'Riding', title: 'Ride in progress', action: 'End ride' },
  debrief: { step: 'Step 3 of 3', title: 'Debrief', action: 'Save debrief' },
  done: { step: 'Done', title: 'Ride wrapped up', action: 'View debrief' },
};

const toRad = (d: number) => (d * Math.PI) / 180;
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface FixForCheckIn { lat: number; lng: number; timestamp: string | number; accuracy?: number | null }

/** True when this fix is fresh, accurate enough and within 200 m of the meetup point. */
export function qualifiesForAutoCheckIn(fix: FixForCheckIn | null | undefined, meetup: { lat: number; lng: number } | null, now: number = Date.now()): boolean {
  if (!fix || !meetup) return false;
  const at = typeof fix.timestamp === 'number' ? fix.timestamp : Date.parse(fix.timestamp);
  if (!Number.isFinite(at) || now - at > AUTO_CHECK_IN_MAX_FIX_AGE_MS || at - now > 60_000) return false;
  if (fix.accuracy != null && fix.accuracy > AUTO_CHECK_IN_MAX_ACCURACY_M) return false;
  return metersBetween(fix, meetup) <= AUTO_CHECK_IN_RADIUS_M;
}

export function rollCallStatus(rider: RollCallRider): RollCallStatus {
  if (rider.attendance === 'checked_in' || rider.attendance === 'attended') return 'checked_in';
  if (rider.attendance === 'absent' || rider.attendance === 'declined') return 'absent';
  return 'waiting';
}

export interface RollCallSummary {
  checkedIn: RollCallRider[];
  absent: RollCallRider[];
  waiting: RollCallRider[];
  byLocation: number;
  headline: string;
}

export function summariseRollCall(riders: RollCallRider[], captainId?: string | null): RollCallSummary {
  const counted = riders.filter(r => r.userId !== captainId);
  const checkedIn = counted.filter(r => rollCallStatus(r) === 'checked_in');
  const absent = counted.filter(r => rollCallStatus(r) === 'absent');
  const waiting = counted.filter(r => rollCallStatus(r) === 'waiting');
  const byLocation = checkedIn.filter(r => r.checkedInBy === 'location').length;
  const headline = waiting.length === 0
    ? `All ${checkedIn.length + 1} here`
    : `${checkedIn.length + 1} of ${counted.length - absent.length + 1} here · waiting for ${waiting.length}`;
  return { checkedIn, absent, waiting, byLocation, headline };
}

/** Start is always possible; with riders still waiting it needs a reason ("Start anyway"). */
export function canStartRide(summary: RollCallSummary): { ok: boolean; needsOverride: boolean; reason: string } {
  if (summary.waiting.length === 0) return { ok: true, needsOverride: false, reason: 'Everyone is checked in.' };
  const names = summary.waiting.slice(0, 3).map(r => r.name).join(', ');
  const more = summary.waiting.length > 3 ? ` and ${summary.waiting.length - 3} more` : '';
  return { ok: false, needsOverride: true, reason: `Still waiting for ${names}${more}.` };
}

export const START_ANYWAY_REASONS = [
  'Late riders will catch up',
  'Riders are here, phones are offline',
  'Running out of daylight',
] as const;

/** Riders expected at a regroup who have not confirmed arrival. Absent riders never count. */
export function missingAtRegroup(riders: RollCallRider[], arrivedIds: Iterable<string>): RollCallRider[] {
  const arrived = new Set(arrivedIds);
  return riders.filter(r => rollCallStatus(r) !== 'absent' && !arrived.has(r.userId));
}

export function allThroughSentence(pointName: string, missing: Array<{ name: string }>): string {
  if (!missing.length) return `All through at ${pointName}. Everyone accounted for.`;
  const names = missing.slice(0, 4).map(m => m.name).join(', ');
  const more = missing.length > 4 ? ` +${missing.length - 4}` : '';
  return `Sweep passed ${pointName}. Not seen: ${names}${more}.`;
}

export interface BriefingInput {
  rideName: string;
  startTime?: string | null;
  meetupName?: string | null;
  lead?: string | null;
  sweep?: string | null;
  regroupPoints: Array<{ name: string; targetArrival?: string | null }>;
  handSignals: string[];
  notes?: string | null;
  distanceKm?: number | null;
}

export const DEFAULT_HAND_SIGNALS = [
  'Left arm up: stop ahead',
  'Pat helmet: I lead / you lead',
  'Point down left: pothole or debris',
  'Palm down, wave: slow down',
  'Point at tank: fuel stop needed',
];

export interface BriefingCard { title: string; lines: Array<{ label: string; value: string }>; signals: string[]; notes: string | null }

/** The briefing is generated from the trip, not typed. */
export function buildBriefing(input: BriefingInput): BriefingCard {
  const lines: Array<{ label: string; value: string }> = [];
  if (input.meetupName) lines.push({ label: 'Meet', value: input.meetupName + (input.startTime ? ` · ${input.startTime}` : '') });
  lines.push({ label: 'Lead', value: input.lead || 'Captain' });
  lines.push({ label: 'Sweep', value: input.sweep || 'Not assigned' });
  if (input.distanceKm) lines.push({ label: 'Distance', value: `${Math.round(input.distanceKm)} km` });
  if (input.regroupPoints.length) {
    lines.push({
      label: 'Regroups',
      value: input.regroupPoints.map(p => p.name + (p.targetArrival ? ` (${p.targetArrival})` : '')).join(' → '),
    });
  }
  return { title: input.rideName, lines, signals: input.handSignals.length ? input.handSignals : DEFAULT_HAND_SIGNALS, notes: input.notes?.trim() || null };
}

export interface DebriefInput {
  rideName: string;
  distanceKm?: number | null;
  durationMinutes?: number | null;
  riders: number;
  alerts: Array<{ type: string; created_at?: string }>;
  fuelSpendInr?: number | null;
  regroupsMissing: Array<{ point: string; names: string[] }>;
  startOverrideReason?: string | null;
}

export interface Debrief { title: string; summary: string; facts: string[] }

const ALERT_WORDS: Record<string, string> = {
  emergency: 'SOS', mechanical: 'mechanical', fuel: 'fuel', break: 'break', route_deviation: 'off-route',
  rider_behind: 'rider behind', regroup: 'regroup', announcement: 'announcement', check_in_missed: 'missed check-in',
};

export function buildDebrief(input: DebriefInput): Debrief {
  const facts: string[] = [];
  const parts: string[] = [];
  if (input.distanceKm) parts.push(`${Math.round(input.distanceKm)} km`);
  if (input.durationMinutes) {
    const h = Math.floor(input.durationMinutes / 60);
    const m = Math.round(input.durationMinutes % 60);
    parts.push(h ? `${h} h ${m} min` : `${m} min`);
  }
  parts.push(`${input.riders} rider${input.riders === 1 ? '' : 's'}`);
  const counts = new Map<string, number>();
  for (const a of input.alerts) if (a.type !== 'announcement' && a.type !== 'regroup') counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const sos = counts.get('emergency') ?? 0;
  if (counts.size === 0) facts.push('No alerts raised.');
  else facts.push('Alerts: ' + [...counts.entries()].map(([t, n]) => `${n} ${ALERT_WORDS[t] ?? t}`).join(', ') + '.');
  if (input.fuelSpendInr) facts.push(`Fuel logged: ₹${Math.round(input.fuelSpendInr).toLocaleString('en-IN')}.`);
  for (const r of input.regroupsMissing) if (r.names.length) facts.push(`Not seen at ${r.point}: ${r.names.join(', ')}.`);
  if (input.startOverrideReason) facts.push(`Started before roll call finished: ${input.startOverrideReason}.`);
  const summary = sos ? `${parts.join(' · ')}. ${sos} SOS raised; check the notes.` : `${parts.join(' · ')}. Everyone home safe?`;
  return { title: `Debrief · ${input.rideName}`, summary, facts };
}
