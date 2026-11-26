'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  formatRouteDistance, formatRouteDuration, exportTripToGpx, tripFileName, TRIP_TYPE_LABELS, TRIP_VISIBILITY_LABELS, WAYPOINT_META,
  type Ride, type RouteWaypointType, type TripDay, type TripPlanType, type TripStay, type TripWaypoint,
} from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { formatTripDates, friendlyTripError, useRequiredSession } from '@/lib/planner';

const TripMap = dynamic(() => import('@/components/trip-map'), { ssr: false, loading: () => <div className="h-full min-h-80 rounded-lg bg-map" /> });

type Visibility = 'private' | 'invite_only' | 'public';
const inputClass = 'field';
const labelClass = 'field-label';

export default function TripView({ tripId }: { tripId: string | null }) {
  const session = useRequiredSession();
  const router = useRouter();
  const [trip, setTrip] = useState<Ride | null>(null);
  const [waypoints, setWaypoints] = useState<TripWaypoint[]>([]);
  const [days, setDays] = useState<TripDay[]>([]);
  const [stays, setStays] = useState<TripStay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'invite_only' as Visibility, maxParticipants: '', rules: '' });

  useEffect(() => {
    if (!session || !tripId) return;
    let cancelled = false;
    async function load() {
      try {
        const [rideRes, wpRes, dayRes, stayRes] = await Promise.all([
          supabase.from('rides').select('*').eq('id', tripId).single(),
          supabase.from('trip_waypoints').select('*').eq('ride_id', tripId).order('sequence'),
          supabase.from('trip_days').select('*').eq('ride_id', tripId).order('day_number'),
          supabase.from('trip_stays').select('*').eq('ride_id', tripId).order('check_in'),
        ]);
        if (rideRes.error) throw rideRes.error;
        if (cancelled) return;
        setTrip(rideRes.data as Ride);
        setWaypoints((wpRes.data as TripWaypoint[] | null) ?? []);
        setDays((dayRes.data as TripDay[] | null) ?? []);
        setStays((stayRes.data as TripStay[] | null) ?? []);
        setError(null);
      } catch {
        if (!cancelled) setError('This trip could not be loaded. It may have been deleted, or you are not part of it.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [session, tripId, reload]);

  const points = useMemo(() => waypoints.length
    ? waypoints.map(w => ({ name: w.name, type: w.waypoint_type, longitude: w.longitude, latitude: w.latitude }))
    : trip ? [
      { name: trip.origin, type: 'origin', longitude: trip.origin_coords[0], latitude: trip.origin_coords[1] },
      { name: trip.destination, type: 'destination', longitude: trip.destination_coords[0], latitude: trip.destination_coords[1] },
    ] : [], [waypoints, trip]);

  const isLeader = !!trip && trip.admin_id === session?.user.id;

  function startEdit() {
    if (!trip) return;
    setForm({ name: trip.name, description: trip.description ?? '', visibility: (trip.visibility ?? 'invite_only') as Visibility, maxParticipants: trip.max_participants ? String(trip.max_participants) : '', rules: trip.ride_rules ?? '' });
    setNotice(null); setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!trip || busy) return;
    if (!form.name.trim()) { setNotice('Give the trip a name.'); return; }
    const max = form.maxParticipants.trim() ? Number(form.maxParticipants) : null;
    if (max != null && (!Number.isInteger(max) || max < 2 || max > 500)) { setNotice('Pack size must be a whole number from 2 to 500.'); return; }
    setBusy(true); setNotice(null);
    const { error: updateError } = await supabase.from('rides').update({
      name: form.name.trim(), description: form.description.trim() || null, visibility: form.visibility, max_participants: max, ride_rules: form.rules.trim() || null,
    }).eq('id', trip.id);
    setBusy(false);
    if (updateError) { setNotice(friendlyTripError(updateError, 'Could not save the changes.')); return; }
    setEditing(false); setNotice('Trip details saved.'); setReload(v => v + 1);
  }

  function downloadGpx() {
    if (!trip) return;
    const gpx = exportTripToGpx({
      tripName: trip.name,
      description: trip.description,
      waypoints: waypoints.length
        ? waypoints.map(w => ({ name: w.name, latitude: w.latitude, longitude: w.longitude, waypoint_type: w.waypoint_type, notes: w.notes }))
        : points.map(p => ({ name: p.name, latitude: p.latitude, longitude: p.longitude, waypoint_type: p.type })),
      routeCoordinates: trip.route_geometry?.geometry?.coordinates as [number, number][] | undefined,
    });
    const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = tripFileName(trip.name, 'gpx');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function remove() {
    if (!trip || busy) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc('delete_trip', { p_ride_id: trip.id });
    if (deleteError) { setBusy(false); setConfirmDelete(false); setNotice(friendlyTripError(deleteError, 'Could not delete the trip.')); return; }
    router.replace('/app/trips');
  }

  if (!tripId) return <Shell><p className="text-muted">No trip selected. <Link className="underline" href="/app/trips">See all trips</Link></p></Shell>;
  if (loading) return <Shell><p role="status" className="text-muted">Loading trip…</p></Shell>;
  if (error || !trip) return <Shell><div role="alert" className="notice notice-error">{error}<Link href="/app/trips" className="ml-4 underline">Back to trips</Link></div></Shell>;

  return (
    <Shell>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <Link href="/app/trips" className="text-sm text-muted hover:text-fg">← All trips</Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <h1 className="display text-3xl sm:text-4xl">{trip.name}</h1>
            <span className="chip chip-accent">{trip.status}</span>
          </div>
          <p className="mt-2 text-sm text-muted">{formatTripDates(trip.start_date, trip.end_date)} · {TRIP_TYPE_LABELS[(trip.trip_type ?? 'group') as TripPlanType]} · {TRIP_VISIBILITY_LABELS[(trip.visibility ?? 'invite_only') as Visibility]}</p>
          <dl className="mt-6 grid grid-cols-3 gap-3">
            <Stat label="Distance" value={formatRouteDistance(trip.estimated_distance_meters)} />
            <Stat label="Riding time" value={formatRouteDuration(trip.estimated_duration_seconds)} />
            <Stat label="Invite code" value={trip.ride_code} mono />
          </dl>
          {trip.description && <p className="mt-6 whitespace-pre-line text-sm leading-6">{trip.description}</p>}
          {notice && <p role="status" className="mt-6 notice text-sm">{notice}</p>}

          {editing ? (
            <form onSubmit={save} className="mt-6 space-y-4 panel p-5">
              <h2 className="text-sm font-semibold">Edit trip details</h2>
              <div><label htmlFor="edit-name" className={labelClass}>Trip name</label><input id="edit-name" className={inputClass} value={form.name} maxLength={120} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label htmlFor="edit-notes" className={labelClass}>Notes for riders</label><textarea id="edit-notes" className={inputClass + ' min-h-20'} value={form.description} maxLength={2000} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="edit-visibility" className={labelClass}>Who can find it</label>
                  <select id="edit-visibility" className={inputClass} value={form.visibility} onChange={e => setForm(f => ({ ...f, visibility: e.target.value as Visibility }))}>
                    {Object.entries(TRIP_VISIBILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label htmlFor="edit-max" className={labelClass}>Pack size limit</label><input id="edit-max" inputMode="numeric" className={inputClass} placeholder="No limit" value={form.maxParticipants} onChange={e => setForm(f => ({ ...f, maxParticipants: e.target.value }))} /></div>
              </div>
              <div><label htmlFor="edit-rules" className={labelClass}>Ride rules</label><textarea id="edit-rules" className={inputClass + ' min-h-20'} value={form.rules} maxLength={2000} onChange={e => setForm(f => ({ ...f, rules: e.target.value }))} placeholder="Helmets on, no overtaking the lead." /></div>
              <div className="flex gap-3">
                <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save changes'}</button>
                <button type="button" onClick={() => setEditing(false)} className="btn hover:bg-raise">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              {trip.status === 'active' && <Link href={'/app/rides/' + trip.id} className="btn btn-primary">Open live map</Link>}
              {isLeader && <button onClick={startEdit} className="btn btn-ghost">Edit details</button>}
              {isLeader && !confirmDelete && <button onClick={() => setConfirmDelete(true)} className="btn text-danger hover:bg-raise">Delete trip</button>}
            </div>
          )}
          {confirmDelete && (
            <div role="alertdialog" aria-labelledby="delete-title" className="mt-4 notice notice-error p-5">
              <p id="delete-title" className="text-sm font-semibold">Delete “{trip.name}” for everyone?</p>
              <p className="mt-1 text-sm text-muted">The route, stops, days and records go too. This cannot be undone.</p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => void remove()} disabled={busy} className="btn btn-danger">{busy ? 'Deleting…' : 'Delete trip'}</button>
                <button onClick={() => setConfirmDelete(false)} className="btn hover:bg-raise">Keep trip</button>
              </div>
            </div>
          )}

          <section className="mt-10" aria-labelledby="route-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="route-heading" className="font-display text-xl font-semibold">Route</h2>
              <div className="flex gap-2">
                <button type="button" onClick={downloadGpx} className="btn btn-ghost px-3 py-1.5 text-xs">Download GPX</button>
                {isLeader && <Link href={'/app/trips/' + trip.id + '/route'} className="btn btn-ghost px-3 py-1.5 text-xs">Edit route</Link>}
              </div>
            </div>
            <ol className="mt-4 space-y-2">
              {points.map((p, i) => (
                <li key={i} className="flex items-center gap-3 rounded border border-line bg-surface px-4 py-3 text-sm">
                  <span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ' + (p.type === 'origin' || p.type === 'destination' ? 'bg-fg text-bg' : 'bg-accent text-on-accent')}>{p.type === 'origin' ? 'A' : p.type === 'destination' ? 'B' : i}</span>
                  <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="text-xs text-muted">{WAYPOINT_META[p.type as RouteWaypointType]?.label ?? 'Stop'}</span></span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-faint">GPX works with most navigation apps and GPS units.</p>
          </section>

          {days.length > 0 && (
            <section className="mt-10" aria-labelledby="days-heading">
              <h2 id="days-heading" className="font-display text-xl font-semibold">Days</h2>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {days.map(d => <li key={d.id} className="rounded border border-line bg-surface px-4 py-3 text-sm"><span className="font-medium">{d.title || 'Day ' + d.day_number}</span><span className="block text-xs text-muted">{d.trip_date ? formatTripDates(d.trip_date, d.trip_date) : 'Date not set'}</span></li>)}
              </ul>
            </section>
          )}
          {stays.length > 0 && (
            <section className="mt-10" aria-labelledby="stays-heading">
              <h2 id="stays-heading" className="font-display text-xl font-semibold">Stays</h2>
              <ul className="mt-4 space-y-2">
                {stays.map(s => <li key={s.id} className="rounded border border-line bg-surface px-4 py-3 text-sm"><span className="font-medium">{s.name}</span><span className="block text-xs text-muted">{[s.address, s.check_in && formatTripDates(s.check_in.slice(0, 10), s.check_out?.slice(0, 10))].filter(Boolean).join(' · ')}</span></li>)}
              </ul>
            </section>
          )}
        </div>
        <aside className="min-h-[420px] lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">
          <TripMap points={points} route={trip.route_geometry?.geometry ?? null} className="h-full min-h-[420px]" />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">{children}</main>;
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded border border-line bg-surface px-4 py-3"><dt className="eyebrow-label text-[10px]">{label}</dt><dd className={'mt-1 text-base font-semibold ' + (mono ? 'font-mono tracking-widest text-accent' : '')}>{value}</dd></div>;
}
