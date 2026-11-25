/**
 * F11 rider road reports: shared words, map features and the "ahead of you"
 * warning. Reports live 48 hours; every rider who confirms one adds a day.
 */

import { calculateDistanceAlongPolyline } from './route';
import type { AttentionItem } from './attention';

export type RoadReportType =
  | 'pothole' | 'landslide' | 'water_crossing' | 'snow_ice' | 'closure'
  | 'police_check' | 'animals' | 'accident' | 'fuel_out' | 'other';

export const ROAD_REPORT_TYPES: Array<{ type: RoadReportType; label: string; short: string; severe: boolean }> = [
  { type: 'landslide', label: 'Landslide or debris', short: 'Landslide', severe: true },
  { type: 'closure', label: 'Road closed', short: 'Road closed', severe: true },
  { type: 'water_crossing', label: 'Water crossing', short: 'Water crossing', severe: true },
  { type: 'snow_ice', label: 'Snow or black ice', short: 'Snow / ice', severe: true },
  { type: 'accident', label: 'Accident', short: 'Accident', severe: true },
  { type: 'pothole', label: 'Bad potholes', short: 'Potholes', severe: false },
  { type: 'animals', label: 'Animals on the road', short: 'Animals', severe: false },
  { type: 'police_check', label: 'Police check', short: 'Police check', severe: false },
  { type: 'fuel_out', label: 'Fuel station dry', short: 'No fuel', severe: false },
  { type: 'other', label: 'Something else', short: 'Road report', severe: false },
];

const BY_TYPE = new Map(ROAD_REPORT_TYPES.map(t => [t.type, t]));
export function roadReportLabel(type: string): string {
  return BY_TYPE.get(type as RoadReportType)?.short ?? 'Road report';
}

export interface RoadReport {
  id: string;
  type: RoadReportType;
  lat: number;
  lng: number;
  note?: string | null;
  created_at: string;
  expires_at: string;
  confirm_count: number;
  mine?: boolean;
  confirmed_by_me?: boolean;
  /** Still in this phone's queue: shown, but nobody else can see it yet. */
  pending?: boolean;
}

export function reportAge(createdAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(createdAt)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function reportTrust(report: Pick<RoadReport, 'confirm_count' | 'created_at' | 'pending'>, now = Date.now()): string {
  if (report.pending) return 'Waiting for signal to share';
  const confirmed = report.confirm_count > 0 ? `Confirmed by ${report.confirm_count} rider${report.confirm_count === 1 ? '' : 's'}` : 'Reported once';
  return `${confirmed} · ${reportAge(report.created_at, now)}`;
}

export function roadReportFeatures(reports: RoadReport[], now = Date.now()) {
  return {
    type: 'FeatureCollection' as const,
    features: reports
      .filter(r => Date.parse(r.expires_at) > now && Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .map(r => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
        properties: {
          id: r.id,
          label: roadReportLabel(r.type),
          severe: Boolean(BY_TYPE.get(r.type)?.severe),
          pending: Boolean(r.pending),
        },
      })),
  };
}

/**
 * The nearest active report on the route ahead (within `withinKm`), as an
 * attention item. Reports more than 300 m off the route are ignored.
 */
export function roadReportAheadAttention(
  position: { lat: number; lng: number } | null | undefined,
  routeCoords: number[][] | null | undefined,
  reports: RoadReport[],
  nowIso: string,
  withinKm = 3,
): AttentionItem | null {
  if (!position || !Array.isArray(routeCoords) || routeCoords.length < 2) return null;
  const me = calculateDistanceAlongPolyline(position, routeCoords);
  if (me.distanceToRouteMeters > 1500) return null;
  const now = Date.parse(nowIso);
  let best: { r: RoadReport; aheadM: number } | null = null;
  for (const r of reports) {
    if (r.mine || r.pending || Date.parse(r.expires_at) <= now) continue;
    const at = calculateDistanceAlongPolyline({ lat: r.lat, lng: r.lng }, routeCoords);
    if (at.distanceToRouteMeters > 300) continue;
    const aheadM = at.distanceAlongRouteMeters - me.distanceAlongRouteMeters;
    if (aheadM < -100 || aheadM > withinKm * 1000) continue;
    if (!best || aheadM < best.aheadM) best = { r, aheadM };
  }
  if (!best) return null;
  const { r, aheadM } = best;
  const where = aheadM <= 150 ? 'here' : aheadM < 1000 ? `${Math.round(aheadM / 50) * 50} m ahead` : `${(aheadM / 1000).toFixed(1)} km ahead`;
  const actions: AttentionItem['actions'] = [];
  if (!r.confirmed_by_me && aheadM <= 300) actions.push({ id: 'road_confirm', label: 'Still there', emphasis: 'primary' });
  actions.push({ id: 'dismiss_road', label: 'OK', emphasis: 'secondary' });
  return {
    id: `road:${r.id}`,
    kind: 'hazard',
    title: `${roadReportLabel(r.type)} ${where}`,
    body: [r.note, reportTrust(r, now)].filter(Boolean).join(' · '),
    createdAt: r.created_at,
    actions,
  };
}
