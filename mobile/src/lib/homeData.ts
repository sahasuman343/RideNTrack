import type { Ride } from '@ridentrack/shared';
import { supabase } from './supabase';

export async function loadHomeData(userId: string) {
  const { data, error } = await supabase.from('ride_participants')
    .select('ride_id, rides(*)').eq('user_id', userId).eq('is_active', true)
    .order('joined_at', { ascending: false });
  if (error || !data) throw new Error(error?.message || 'Trip data is unavailable.');
  const rides: Ride[] = data.flatMap(row => row.rides || []) as unknown as Ride[];
  const checkedAt = Date.now();
  const ongoingTrip = rides.find(r => r.status === 'active') ?? null;
  let members: number | null = null;
  if (ongoingTrip) {
    const result = await supabase.from('ride_participants').select('*', { count: 'exact', head: true })
      .eq('ride_id', ongoingTrip.id).eq('is_active', true);
    if (!result.error) members = result.count;
  }
  return { ongoingTrip, checkedAt, members, planned: rides.filter(r => r.status === 'planned') };
}

export function nextPlannedTrip(planned: Ride[], today: Date) {
  // Compare calendar days, not elapsed hours across local midnight or DST.
  const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dated = planned.flatMap(trip => {
    const date = trip.start_date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const ms = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(ms) || !new Date(ms).toISOString().startsWith(date)) return [];
    return [{ trip, days: (ms - todayMs) / 86400000 }];
  }).sort((a, b) => a.days - b.days);
  const selected = dated.find(r => r.days >= 0) ?? dated[dated.length - 1];
  if (!selected) return planned[0] ? { trip: planned[0], title: 'Planned trip', when: 'date unavailable' } : null;
  const { days, trip } = selected;
  return days < 0
    ? { trip, title: 'Overdue trip', when: `${-days} ${days === -1 ? 'day' : 'days'} overdue` }
    : { trip, title: 'Next trip', when: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days` };
}
