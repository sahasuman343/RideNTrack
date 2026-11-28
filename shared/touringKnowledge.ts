/**
 * F10 touring knowledge layer.
 *
 * Curated routes, points of interest (fuel, mechanics, ATMs) and advisories
 * (permits, pass opening windows). The maths here is pure: which known route
 * a trip follows, where the fuel gaps are for this pack, and when to warn a
 * rider that they are at the last fuel for a long stretch.
 */

import { calculateDistanceAlongPolyline, distanceToRouteMeters } from './route';
import type { AttentionItem } from './attention';

export type PoiKind = 'fuel' | 'mechanic' | 'atm';

export interface TouringRoute {
  id: string;
  name: string;
  region: string;
  /** Reference line, [lng, lat] pairs, a point every few kilometres is enough. */
  line: [number, number][];
}

export interface RoutePoi {
  id: string;
  route_id?: string | null;
  kind: PoiKind;
  name: string;
  lat: number;
  lng: number;
  /** Null until someone has checked it on the ground this season. */
  verified_at?: string | null;
  source?: string | null;
  note?: string | null;
}

export type AdvisoryKind = 'permit' | 'pass_window' | 'closure' | 'info';

export interface RouteAdvisory {
  id: string;
  route_id: string;
  kind: AdvisoryKind;
  title: string;
  body: string;
  /** Month-day window that repeats each year, e.g. '06-01'..'10-15'. Null means all year. */
  season_from?: string | null;
  season_to?: string | null;
  url?: string | null;
  verified_at?: string | null;
}

const MATCH_WITHIN_M = 5000;
const MATCH_MIN_SHARE = 0.6;
const SAMPLE_EVERY_M = 2000;

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthKm(line: number[][]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += haversineM(line[i - 1] as [number, number], line[i] as [number, number]);
  return m / 1000;
}

/** Points along a line at most every `stepM` metres, keeping the ends. */
export function sampleLine(line: number[][], stepM = SAMPLE_EVERY_M): [number, number][] {
  const out: [number, number][] = [];
  if (!line.length) return out;
  out.push(line[0] as [number, number]);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as [number, number];
    const b = line[i] as [number, number];
    const d = haversineM(a, b);
    const n = Math.floor(d / stepM);
    for (let k = 1; k <= n; k++) {
      const t = (k * stepM) / d;
      if (t < 1) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
  }
  return out;
}

/**
 * The known route this trip follows, if most of the trip's line lies within
 * 5 km of it. Either direction counts (Manali to Leh and Leh to Manali).
 */
export function matchKnownRoute(tripLine: number[][] | null | undefined, routes: TouringRoute[]): { route: TouringRoute; share: number } | null {
  if (!Array.isArray(tripLine) || tripLine.length < 2) return null;
  const samples = sampleLine(tripLine);
  let best: { route: TouringRoute; share: number } | null = null;
  for (const route of routes) {
    if (!route.line || route.line.length < 2) continue;
    let near = 0;
    for (const [lng, lat] of samples) if (distanceToRouteMeters({ lat, lng }, route.line) <= MATCH_WITHIN_M) near++;
    const share = near / samples.length;
    if (share >= MATCH_MIN_SHARE && (!best || share > best.share)) best = { route, share };
  }
  return best;
}

export interface FuelStop {
  poi: RoutePoi;
  /** Distance from the start of the trip along its route. */
  atKm: number;
}

export interface FuelStretch {
  from: FuelStop | null; // null = trip start
  to: FuelStop | null;   // null = trip end
  fromKm: number;
  toKm: number;
  lengthKm: number;
  /** Longer than the pack's safe range: someone runs dry without extra fuel. */
  exceedsRange: boolean;
  /** Long enough to deserve a "last fuel" warning. */
  long: boolean;
}

export interface FuelGapReport {
  stops: FuelStop[];
  stretches: FuelStretch[];
  gaps: FuelStretch[];
  /** Sentences for the trip workspace, most serious first. */
  warnings: string[];
}

/** A stretch at least this long, or 60% of the pack's range, earns a "last fuel" warning. */
export const LONG_FUEL_STRETCH_KM = 100;
const FUEL_CORRIDOR_M = 3000;

function stationName(stop: FuelStop | null, fallback: string) {
  return stop ? stop.poi.name : fallback;
}

/**
 * Splits a route at the fuel stations along it and marks the stretches longer
 * than the pack's safe range (the limiting rider's tank minus reserve). The
 * trip is assumed to start with full tanks.
 */
export function findFuelGaps(
  routeCoords: number[][] | null | undefined,
  fuelPois: RoutePoi[],
  packSafeRangeKm: number | null | undefined,
): FuelGapReport {
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) return { stops: [], stretches: [], gaps: [], warnings: [] };
  const totalKm = lineLengthKm(routeCoords);
  const range = packSafeRangeKm && packSafeRangeKm > 0 ? packSafeRangeKm : null;
  const longAt = Math.min(LONG_FUEL_STRETCH_KM, range ? range * 0.6 : LONG_FUEL_STRETCH_KM);

  const stops: FuelStop[] = [];
  for (const poi of fuelPois) {
    if (poi.kind !== 'fuel' || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;
    const { distanceAlongRouteMeters, distanceToRouteMeters: off } = calculateDistanceAlongPolyline({ lat: poi.lat, lng: poi.lng }, routeCoords);
    if (off > FUEL_CORRIDOR_M) continue;
    // calculateDistanceAlongPolyline uses a flat projection; scale to the haversine total so ends line up.
    stops.push({ poi, atKm: distanceAlongRouteMeters / 1000 });
  }
  stops.sort((a, b) => a.atKm - b.atKm);
  const lastAt = stops.length ? stops[stops.length - 1].atKm : 0;
  const scale = lastAt > totalKm && lastAt > 0 ? totalKm / lastAt : 1;
  for (const s of stops) s.atKm = Math.round(s.atKm * scale * 10) / 10;

  const stretches: FuelStretch[] = [];
  let prev: FuelStop | null = null;
  let prevKm = 0;
  for (const stop of [...stops, null]) {
    const toKm = stop ? stop.atKm : Math.round(totalKm * 10) / 10;
    const lengthKm = Math.round((toKm - prevKm) * 10) / 10;
    if (lengthKm > 0.5 || stop === null) {
      stretches.push({
        from: prev, to: stop, fromKm: prevKm, toKm, lengthKm,
        exceedsRange: range != null && lengthKm > range,
        long: lengthKm >= longAt,
      });
    }
    if (stop) { prev = stop; prevKm = stop.atKm; }
  }

  const gaps = stretches.filter(s => s.exceedsRange);
  const warnings: string[] = [];
  for (const g of gaps) {
    warnings.push(`${Math.round(g.lengthKm)} km with no fuel after ${stationName(g.from, 'the start')}, more than the pack's ${Math.round(range!)} km range. Carry extra fuel.`);
  }
  for (const s of stretches) {
    if (s.long && !s.exceedsRange && s.from) {
      warnings.push(`${s.from.poi.name} is the last fuel for ${Math.round(s.lengthKm)} km. Fill up there.`);
    }
  }
  return { stops, stretches, gaps, warnings };
}

/**
 * Live warning around the last station before a long stretch. Shows from
 * 5 km before the station until 3 km after it, then goes away.
 */
export function lastFuelAttention(
  progressKm: number,
  report: FuelGapReport,
  nowIso: string,
): AttentionItem | null {
  for (const s of report.stretches) {
    if (!s.from || !(s.long || s.exceedsRange)) continue;
    const toStation = s.from.atKm - progressKm;
    if (toStation > 5 || toStation < -3) continue;
    const ahead = toStation > 0.2;
    return {
      id: `fuel:last:${s.from.poi.id}`,
      kind: 'fuel',
      title: ahead
        ? `Last fuel for ${Math.round(s.lengthKm)} km in ${toStation < 1 ? 'under 1' : Math.round(toStation)} km`
        : `You are at the last fuel for ${Math.round(s.lengthKm)} km`,
      body: `${s.from.poi.name}. Next fuel: ${s.to ? `${s.to.poi.name}, ` : ''}${Math.round(s.lengthKm)} km on.${s.from.poi.verified_at ? '' : ' Not verified this season.'}`,
      createdAt: nowIso,
      actions: [
        { id: 'fuel_directions', label: 'Directions', emphasis: 'primary' },
        { id: 'dismiss_fuel', label: 'Got fuel', emphasis: 'secondary' },
      ],
    };
  }
  return null;
}

function monthDay(iso: string): string {
  return iso.slice(5, 10);
}

/** Is an advisory in force on this date (season windows can wrap the new year)? */
export function advisoryInSeason(advisory: Pick<RouteAdvisory, 'season_from' | 'season_to'>, dateIso: string): boolean {
  if (!advisory.season_from || !advisory.season_to) return true;
  const d = monthDay(dateIso);
  const { season_from: from, season_to: to } = advisory;
  return from <= to ? d >= from && d <= to : d >= from || d <= to;
}

/**
 * What a rider must know for a trip starting on this date: permits always,
 * pass windows explained either way ("opens around 1 June" when out of season).
 */
export function advisoriesForTrip(advisories: RouteAdvisory[], startDateIso: string | null | undefined): Array<RouteAdvisory & { inSeason: boolean; sentence: string }> {
  const date = startDateIso && /^\d{4}-\d{2}-\d{2}/.test(startDateIso) ? startDateIso : new Date().toISOString();
  const order: Record<AdvisoryKind, number> = { closure: 0, permit: 1, pass_window: 2, info: 3 };
  return advisories
    .map(a => {
      const inSeason = advisoryInSeason(a, date);
      const sentence = a.kind === 'pass_window' && !inSeason && a.season_from
        ? `${a.title}: usually closed on your dates. Opens around ${formatMonthDay(a.season_from)}.`
        : `${a.title}: ${a.body}`;
      return { ...a, inSeason, sentence };
    })
    .filter(a => a.kind !== 'closure' || a.inSeason)
    .sort((a, b) => order[a.kind] - order[b.kind]);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatMonthDay(md: string): string {
  const [m, d] = md.split('-').map(Number);
  return m >= 1 && m <= 12 && d ? `${d} ${MONTHS[m - 1]}` : md;
}
