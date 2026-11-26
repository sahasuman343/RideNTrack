'use client';
import { useEffect, useState } from 'react';
import { ATTENDANCE_STATUS_LABELS, ROLE_LABELS, type AttendanceStatus, type RideParticipantRole } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { friendlyTripError } from '@/lib/planner';

export type RosterRider = { user_id: string; display_name: string | null; role: RideParticipantRole; is_active: boolean; last_seen: string | null; attendance_status: AttendanceStatus | null };

const ASSIGNABLE: RideParticipantRole[] = ['co-captain', 'marshal', 'sweeper', 'member'];
const RSVP: AttendanceStatus[] = ['confirmed', 'tentative', 'declined'];
const ROLE_HELP: Partial<Record<RideParticipantRole, string>> = {
  'co-captain': 'Navigates and stands in for the leader',
  marshal: 'Holds junctions so the pack stays together',
  sweeper: 'Rides at the back and helps with breakdowns',
  member: 'Rides in the pack',
};

const initials = (name: string | null) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
const attendanceLabel = (s: AttendanceStatus | null) => ATTENDANCE_STATUS_LABELS[s ?? 'confirmed']?.label ?? 'Going';

interface Props {
  trip: { id: string; admin_id: string; ride_code: string; name: string };
  userId: string;
  onLeadershipChanged: () => void;
  onLeft: () => void;
}

/** Riders on a trip: RSVP, invite link, and the leader's people tools. */
export default function TripPeople({ trip, userId, onLeadershipChanged, onLeft }: Props) {
  const [roster, setRoster] = useState<RosterRider[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'lead' | 'leave'; rider?: RosterRider } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const isLeader = trip.admin_id === userId;

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_trip_roster', { p_ride_id: trip.id }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setLoadError(true); return; }
      setRoster(Array.isArray(data) ? (data as RosterRider[]) : []);
      setLoadError(false);
    });
    return () => { cancelled = true; };
  }, [trip.id, retry]);

  const me = roster?.find(r => r.user_id === userId);
  const going = roster?.filter(r => (r.attendance_status ?? 'confirmed') === 'confirmed').length ?? 0;

  async function run(action: () => PromiseLike<{ error: unknown }>, ok: string, fallback: string) {
    setBusy(true); setNotice(null);
    const { error } = await action();
    setBusy(false);
    if (error) { setNotice({ text: friendlyTripError(error, fallback), error: true }); return false; }
    setNotice({ text: ok });
    return true;
  }

  async function setAttendance(status: AttendanceStatus, target?: RosterRider) {
    const done = await run(() => supabase.rpc('update_participant_attendance', { p_ride_id: trip.id, p_status: status, p_target_user_id: target ? target.user_id : null }),
      target ? `${target.display_name ?? 'Rider'} marked ${attendanceLabel(status).toLowerCase()}.` : `You are marked ${attendanceLabel(status).toLowerCase()}.`, 'Could not update attendance.');
    if (done) setRoster(rs => rs?.map(r => r.user_id === (target?.user_id ?? userId) ? { ...r, attendance_status: status } : r) ?? rs);
  }

  async function setRole(rider: RosterRider, role: RideParticipantRole) {
    const done = await run(() => supabase.rpc('set_trip_participant_role', { p_ride_id: trip.id, p_user_id: rider.user_id, p_role: role }),
      `${rider.display_name ?? 'Rider'} is now ${ROLE_LABELS[role].title.toLowerCase()}.`, 'Could not change the role.');
    if (done) setRoster(rs => rs?.map(r => r.user_id === rider.user_id ? { ...r, role } : r) ?? rs);
  }

  async function confirmAction() {
    if (!confirm) return;
    const { kind, rider } = confirm;
    if (kind === 'remove' && rider) {
      const done = await run(() => supabase.rpc('remove_trip_participant', { p_ride_id: trip.id, p_user_id: rider.user_id }), `${rider.display_name ?? 'Rider'} was removed from the trip.`, 'Could not remove the rider.');
      if (done) { setRoster(rs => rs?.filter(r => r.user_id !== rider.user_id) ?? rs); setOpen(null); }
    } else if (kind === 'lead' && rider) {
      const done = await run(() => supabase.rpc('transfer_trip_leadership', { p_ride_id: trip.id, p_new_admin_id: rider.user_id }), `${rider.display_name ?? 'Rider'} now leads the trip.`, 'Could not hand over the trip.');
      if (done) { setOpen(null); setRetry(v => v + 1); onLeadershipChanged(); }
    } else if (kind === 'leave') {
      const done = await run(() => supabase.rpc('leave_ride', { p_ride_id: trip.id }), 'You left the trip.', 'Could not leave the trip.');
      if (done) { onLeft(); return; }
    }
    setConfirm(null);
  }

  async function copyInvite() {
    const link = `${window.location.origin}/app/join?code=${encodeURIComponent(trip.ride_code)}`;
    try { await navigator.clipboard.writeText(link); setNotice({ text: 'Invite link copied. Anyone with it can ask to join with the code ' + trip.ride_code + '.' }); }
    catch { setNotice({ text: 'Copy this link: ' + link }); }
  }

  return (
    <section className="mt-10" aria-labelledby="people-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="people-heading" className="font-display text-xl font-semibold">Riders {roster && <span className="ml-1 font-mono text-sm text-muted">{roster.length}</span>}</h2>
        <button type="button" onClick={() => void copyInvite()} className="btn btn-ghost px-3 py-1.5 text-xs">Copy invite link</button>
      </div>
      {roster && <p className="mt-1 text-xs text-muted">{going} going · invite code <span className="font-mono tracking-widest text-accent">{trip.ride_code}</span></p>}

      {me && (
        <fieldset className="mt-4">
          <legend className="field-label">Are you going?</legend>
          <div className="flex flex-wrap gap-2">
            {RSVP.map(s => {
              const on = (me.attendance_status ?? 'confirmed') === s;
              return <button key={s} type="button" aria-pressed={on} disabled={busy} onClick={() => void setAttendance(s)}
                className={'rounded border px-3 py-1.5 text-sm ' + (on ? 'border-accent text-fg' : 'border-line2 text-muted hover:text-fg')}>{ATTENDANCE_STATUS_LABELS[s].label}</button>;
            })}
          </div>
        </fieldset>
      )}

      {notice && <p role={notice.error ? 'alert' : 'status'} className={'notice mt-4 ' + (notice.error ? 'notice-error' : '')}>{notice.text}</p>}

      {loadError ? (
        <div role="alert" className="notice notice-error mt-4">Could not load the riders. <button className="underline" onClick={() => { setLoadError(false); setRetry(v => v + 1); }}>Try again</button></div>
      ) : !roster ? (
        <div role="status" aria-label="Loading riders" className="mt-4 space-y-2">{[0, 1].map(i => <div key={i} className="h-12 animate-pulse rounded bg-surface" />)}</div>
      ) : roster.length === 0 ? (
        <p className="notice mt-4">No riders yet. Share the invite link to fill the pack.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded border border-line bg-surface" aria-label="Riders on this trip">
          {roster.map(rider => {
            const self = rider.user_id === userId;
            const lead = rider.user_id === trip.admin_id;
            const manageable = isLeader && !self;
            const expanded = open === rider.user_id;
            const name = rider.display_name || 'Rider';
            return (
              <li key={rider.user_id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line2 bg-raise font-mono text-[11px]">{initials(rider.display_name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}{self && <span className="text-muted"> (you)</span>}</span>
                    <span className="text-xs text-muted">{lead ? 'Trip leader' : ROLE_LABELS[rider.role]?.title ?? 'Member'} · {attendanceLabel(rider.attendance_status)}</span>
                  </span>
                  {manageable && <button type="button" aria-expanded={expanded} aria-controls={'manage-' + rider.user_id} onClick={() => { setOpen(expanded ? null : rider.user_id); setConfirm(null); }} className="rounded px-2 py-1 text-xs text-muted hover:bg-raise hover:text-fg">{expanded ? 'Close' : 'Manage'}<span className="sr-only"> {name}</span></button>}
                </div>
                {manageable && expanded && (
                  <div id={'manage-' + rider.user_id} className="mt-3 grid gap-3 rounded border border-line bg-raise p-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={'role-' + rider.user_id} className="field-label">Role</label>
                      <select id={'role-' + rider.user_id} className="field py-2" disabled={busy || lead} value={ASSIGNABLE.includes(rider.role) ? rider.role : 'member'} onChange={e => void setRole(rider, e.target.value as RideParticipantRole)}>
                        {ASSIGNABLE.map(r => <option key={r} value={r}>{ROLE_LABELS[r].title}</option>)}
                      </select>
                      <p className="mt-1 text-xs text-faint">{ROLE_HELP[ASSIGNABLE.includes(rider.role) ? rider.role : 'member']}</p>
                    </div>
                    <div>
                      <label htmlFor={'att-' + rider.user_id} className="field-label">Attendance</label>
                      <select id={'att-' + rider.user_id} className="field py-2" disabled={busy} value={rider.attendance_status ?? 'confirmed'} onChange={e => void setAttendance(e.target.value as AttendanceStatus, rider)}>
                        {(['confirmed', 'tentative', 'declined', 'attended'] as AttendanceStatus[]).map(s => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s].label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'lead', rider })} className="btn btn-ghost px-3 py-1.5 text-xs">Make trip leader</button>
                      <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'remove', rider })} className="btn px-3 py-1.5 text-xs text-danger hover:bg-surface">Remove from trip</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!isLeader && me && !confirm && <button type="button" onClick={() => setConfirm({ kind: 'leave' })} className="mt-4 text-sm text-danger hover:underline">Leave this trip</button>}

      {confirm && (
        <div role="alertdialog" aria-labelledby="people-confirm" className="notice notice-error mt-4 p-5">
          <p id="people-confirm" className="text-sm font-semibold">
            {confirm.kind === 'remove' ? `Remove ${confirm.rider?.display_name ?? 'this rider'} from “${trip.name}”?`
              : confirm.kind === 'lead' ? `Make ${confirm.rider?.display_name ?? 'this rider'} the trip leader?`
              : `Leave “${trip.name}”?`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {confirm.kind === 'remove' ? 'They lose access to the plan and the live map. They can rejoin with the invite code unless the trip is private.'
              : confirm.kind === 'lead' ? 'They will be able to edit and delete the trip. You stay on the trip as a rider.'
              : 'The trip leaves your list. You can rejoin with the invite code unless the trip is private.'}
          </p>
          <div className="mt-4 flex gap-3">
            <button type="button" disabled={busy} onClick={() => void confirmAction()} className={confirm.kind === 'lead' ? 'btn btn-primary' : 'btn btn-danger'}>
              {busy ? 'Working…' : confirm.kind === 'remove' ? 'Remove rider' : confirm.kind === 'lead' ? 'Hand over' : 'Leave trip'}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="btn hover:bg-raise">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
