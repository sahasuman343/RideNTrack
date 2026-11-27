/**
 * F15 clubs: slugs, recurring ride rules and roster text. The recurrence
 * rule is a small RRULE subset that the database also checks:
 *   FREQ=WEEKLY;BYDAY=SU              every Sunday
 *   FREQ=WEEKLY;INTERVAL=2;BYDAY=SA   every other Saturday
 *   FREQ=MONTHLY;BYDAY=1SU            first Sunday of the month
 *   FREQ=MONTHLY;BYDAY=-1SA           last Saturday of the month
 */

export type ClubRole = 'owner' | 'admin' | 'member';
export type ClubJoinPolicy = 'open' | 'code';

export interface ClubMemberRow {
  user_id: string;
  display_name: string;
  role: ClubRole;
  joined_at: string;
  rides: number;
  km: number;
  last_ride_at: string | null;
}

export interface ClubSeries {
  id: string;
  name: string;
  recurrence_rule: string;
  template_ride_id: string | null;
  planned_dates: string[];
}

export interface ClubRideRow {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  distance_km: number;
  visibility: string;
}

export interface ClubView {
  club: { id: string; slug: string; name: string; city: string | null; description: string | null; join_policy: ClubJoinPolicy; verified: boolean; created_at: string };
  my_role: ClubRole | null;
  member_count: number;
  members: ClubMemberRow[];
  series: ClubSeries[];
  rides: ClubRideRow[];
}

export interface MyClub {
  id: string; slug: string; name: string; city: string | null; verified: boolean; role: ClubRole; member_count: number;
  next_ride: { id: string; name: string; start_date: string | null } | null;
}

export const CLUB_SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9]){2,39}$/;

/** "Deccan Dawn Riders!" -> "deccan-dawn-riders". */
export function slugifyClubName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function isValidClubSlug(slug: string): boolean {
  return CLUB_SLUG_PATTERN.test(slug);
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof DAYS)[number];
const DAY_NAMES: Record<Weekday, string> = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
const ORDINALS: Record<string, string> = { '1': 'First', '2': 'Second', '3': 'Third', '4': 'Fourth', '-1': 'Last' };

export interface RecurrenceRule {
  freq: 'WEEKLY' | 'MONTHLY';
  interval: number;
  day: Weekday;
  /** Monthly only: 1..4 or -1 (last). */
  nth: number | null;
}

export const RULE_PATTERN = /^FREQ=(WEEKLY|MONTHLY)(?:;INTERVAL=([1-9]))?;BYDAY=(-1|[1-4])?(MO|TU|WE|TH|FR|SA|SU)$/;

export function parseRecurrenceRule(rule: string | null | undefined): RecurrenceRule | null {
  const m = RULE_PATTERN.exec((rule ?? '').trim().toUpperCase());
  if (!m) return null;
  const freq = m[1] as RecurrenceRule['freq'];
  const nth = m[3] ? Number(m[3]) : null;
  if (freq === 'WEEKLY' && nth != null) return null;
  return { freq, interval: m[2] ? Number(m[2]) : 1, day: m[4] as Weekday, nth: freq === 'MONTHLY' ? nth ?? 1 : null };
}

export function buildRecurrenceRule(r: RecurrenceRule): string {
  const interval = r.interval > 1 ? `;INTERVAL=${r.interval}` : '';
  const nth = r.freq === 'MONTHLY' ? String(r.nth ?? 1) : '';
  return `FREQ=${r.freq}${interval};BYDAY=${nth}${r.day}`;
}

export function describeRecurrence(rule: string): string {
  const r = parseRecurrenceRule(rule);
  if (!r) return 'Custom schedule';
  const day = DAY_NAMES[r.day];
  if (r.freq === 'WEEKLY') return r.interval === 1 ? `Every ${day}` : r.interval === 2 ? `Every other ${day}` : `Every ${r.interval} weeks on ${day}`;
  const month = r.interval === 1 ? 'of the month' : `every ${r.interval} months`;
  return `${ORDINALS[String(r.nth)]} ${day} ${month}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

function nthWeekdayOfMonth(year: number, month: number, day: number, nth: number): Date | null {
  if (nth === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - day + 7) % 7));
    return last;
  }
  const first = new Date(Date.UTC(year, month, 1));
  const date = 1 + ((day - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
  const out = new Date(Date.UTC(year, month, date));
  return out.getUTCMonth() === month ? out : null;
}

/**
 * The next `count` dates (YYYY-MM-DD) on or after `fromIso`. `anchorIso` (the
 * series' first ride) keeps "every other week" on the right weeks.
 */
export function nextOccurrences(rule: string, fromIso: string, count = 4, anchorIso?: string | null): string[] {
  const r = parseRecurrenceRule(rule);
  if (!r || count <= 0) return [];
  const from = utcDate(fromIso);
  const day = DAYS.indexOf(r.day);
  const out: string[] = [];
  if (r.freq === 'WEEKLY') {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + ((day - d.getUTCDay() + 7) % 7));
    if (r.interval > 1 && anchorIso) {
      const anchor = utcDate(anchorIso);
      anchor.setUTCDate(anchor.getUTCDate() + ((day - anchor.getUTCDay() + 7) % 7));
      const weeks = Math.round((d.getTime() - anchor.getTime()) / (7 * 86400000));
      const off = ((weeks % r.interval) + r.interval) % r.interval;
      if (off) d.setUTCDate(d.getUTCDate() + (r.interval - off) * 7);
    }
    while (out.length < count) {
      out.push(isoDate(d));
      d.setUTCDate(d.getUTCDate() + 7 * r.interval);
    }
    return out;
  }
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  if (r.interval > 1 && anchorIso) {
    const a = utcDate(anchorIso);
    const diff = (year - a.getUTCFullYear()) * 12 + (month - a.getUTCMonth());
    const off = ((diff % r.interval) + r.interval) % r.interval;
    month += off ? r.interval - off : 0;
  }
  for (let guard = 0; out.length < count && guard < 120; guard++) {
    const d = nthWeekdayOfMonth(year + Math.floor(month / 12), month % 12, day, r.nth ?? 1);
    if (d && d >= from) out.push(isoDate(d));
    month += r.interval;
  }
  return out;
}

/** The first date a series still needs planned, skipping dates already scheduled. */
export function nextUnplannedDate(series: Pick<ClubSeries, 'recurrence_rule' | 'planned_dates'>, todayIso: string, anchorIso?: string | null): string | null {
  const planned = new Set(series.planned_dates.map(d => String(d).slice(0, 10)));
  return nextOccurrences(series.recurrence_rule, todayIso, 12, anchorIso).find(d => !planned.has(d)) ?? null;
}

/**
 * A date the series is known to ride on, so "every other week" keeps its
 * weeks: the earliest planned date, or else the template trip's date.
 */
export function seriesAnchor(series: Pick<ClubSeries, 'planned_dates' | 'template_ride_id'>, rides: Pick<ClubRideRow, 'id' | 'start_date'>[]): string | null {
  const planned = series.planned_dates.map(d => String(d).slice(0, 10)).sort()[0];
  if (planned) return planned;
  return rides.find(r => r.id === series.template_ride_id)?.start_date?.slice(0, 10) ?? null;
}

export function clubRoleLabel(role: ClubRole): string {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member';
}

/** "12 club rides · 1,480 km" / "Joined in March, no club rides yet". */
export function memberHistoryText(m: Pick<ClubMemberRow, 'rides' | 'km' | 'joined_at'>): string {
  if (!m.rides) {
    const month = new Date(m.joined_at).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `Joined ${month}, no club rides yet`;
  }
  return `${m.rides} club ride${m.rides === 1 ? '' : 's'} · ${m.km.toLocaleString('en-IN')} km`;
}

export function canManageClub(role: ClubRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
