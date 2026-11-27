'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  buildRecurrenceRule, canManageClub, clubRoleLabel, describeRecurrence, memberHistoryText, nextUnplannedDate,
  type ClubMemberRow, type ClubRole, type ClubView, type RecurrenceRule, type Weekday,
} from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { useRequiredSession } from '@/lib/planner';
import { clubDate } from '@/lib/clubs';

const DAYS: { code: Weekday; label: string }[] = [
  { code: 'MO', label: 'Mon' }, { code: 'TU', label: 'Tue' }, { code: 'WE', label: 'Wed' }, { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' }, { code: 'SA', label: 'Sat' }, { code: 'SU', label: 'Sun' },
];
const PATTERNS: { id: string; label: string; rule: (d: Weekday) => RecurrenceRule }[] = [
  { id: 'weekly', label: 'Every week', rule: day => ({ freq: 'WEEKLY', interval: 1, day, nth: null }) },
  { id: 'fortnight', label: 'Every other week', rule: day => ({ freq: 'WEEKLY', interval: 2, day, nth: null }) },
  { id: 'first', label: 'First of the month', rule: day => ({ freq: 'MONTHLY', interval: 1, day, nth: 1 }) },
  { id: 'last', label: 'Last of the month', rule: day => ({ freq: 'MONTHLY', interval: 1, day, nth: -1 }) },
];

type Load = 'loading' | 'ready' | 'missing' | 'error';
const article = (role: ClubRole) => role === 'member' ? 'a member' : `an ${clubRoleLabel(role).toLowerCase()}`;

export default function ClubPage() {
  const { slug } = useParams<{ slug: string }>();
  const session = useRequiredSession();
  const router = useRouter();
  const userId = session?.user.id;
  const [view, setView] = useState<ClubView | null>(null);
  const [state, setState] = useState<Load>('loading');
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_club', { p_slug: slug });
    if (error) { setState(s => s === 'ready' ? s : 'error'); return false; }
    if (!data) { setState('missing'); return true; }
    const next = data as ClubView;
    setView(next); setState('ready');
    if (canManageClub(next.my_role)) {
      const { data: c } = await supabase.rpc('get_club_join_code', { p_club_id: next.club.id });
      setJoinCode(typeof c === 'string' ? c : null);
    } else setJoinCode(null);
    return true;
  }, [slug]);

  useEffect(() => { if (session) void Promise.resolve().then(refresh); }, [session, refresh]);

  /** Runs one change, then reloads the club so what shows is what the server kept. */
  async function run(fn: () => PromiseLike<{ error: { message?: string } | null }>, done?: string) {
    if (busy) return false;
    setBusy(true); setNotice(null);
    const { error } = await fn();
    if (error) { setBusy(false); setNotice({ text: error.message || 'Something went wrong. Try again.', error: true }); return false; }
    await refresh();
    setBusy(false);
    if (done) setNotice({ text: done });
    return true;
  }

  if (state === 'loading' || !session) {
    return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12"><div role="status" aria-label="Loading the club" className="space-y-3"><div className="h-12 w-72 animate-pulse rounded bg-surface" /><div className="h-40 animate-pulse rounded bg-surface" /></div></main>;
  }
  if (state !== 'ready' || !view) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
        <Link href="/app/clubs" className="text-sm text-muted hover:text-fg">← Clubs</Link>
        <h1 className="display mt-6 text-4xl">{state === 'missing' ? 'Club not found' : 'Could not load the club'}</h1>
        <p className="mt-3 text-sm text-muted">{state === 'missing' ? 'The link may be mistyped, or the club was closed.' : 'Check your connection and try again.'}</p>
        {state === 'error' && <button className="btn btn-ghost mt-6" onClick={() => { setState('loading'); void refresh(); }}>Try again</button>}
      </main>
    );
  }

  const { club, my_role: role } = view;
  const manage = canManageClub(role);
  const owner = role === 'owner';
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = view.rides.filter(r => r.status !== 'completed' && r.status !== 'cancelled' && r.status !== 'archived' && (!r.start_date || r.start_date >= today))
    .sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'));
  const past = view.rides.filter(r => r.status === 'completed');
  const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/club/${club.slug}`;

  async function copyInvite() {
    const text = `Ride with ${club.name} on RideNTrack: ${publicUrl}${club.join_policy === 'code' && joinCode ? ` Join code: ${joinCode}.` : ''}`;
    try { await navigator.clipboard.writeText(text); setNotice({ text: 'Invite copied. Paste it into your group chat.' }); }
    catch { setNotice({ text: `Copy this invite: ${text}` }); }
  }

  const memberActions = (m: ClubMemberRow) => {
    const out: { label: string; role: ClubRole | 'removed'; danger?: boolean }[] = [];
    if (owner && m.role === 'member') out.push({ label: 'Make admin', role: 'admin' });
    if (owner && m.role === 'admin') out.push({ label: 'Make member', role: 'member' });
    if (owner && m.role !== 'owner') out.push({ label: 'Make owner', role: 'owner' });
    if (owner || m.role === 'member') out.push({ label: 'Remove from club', role: 'removed', danger: true });
    return out;
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <Link href="/app/clubs" className="text-sm text-muted hover:text-fg">← Clubs</Link>
      <p className="eyebrow-label mt-6">{[club.city, `${view.member_count} rider${view.member_count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="display flex flex-wrap items-center gap-3 text-4xl sm:text-5xl">{club.name}{club.verified && <span className="chip chip-live">Verified</span>}</h1>
        <div className="flex flex-wrap gap-2">
          <a href={`/club/${club.slug}`} className="btn btn-ghost" target="_blank" rel="noopener">Public page</a>
          {manage && <button type="button" className="btn btn-primary" onClick={() => void copyInvite()}>Copy invite</button>}
        </div>
      </div>
      {club.description && <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-6">{club.description}</p>}
      {role && <p className="mt-2 text-sm text-muted">You are {article(role)}.{manage && club.join_policy === 'code' && joinCode ? <> Join code <span className="font-mono text-fg">{joinCode}</span>.</> : ''}</p>}

      {notice && <p role={notice.error ? 'alert' : 'status'} className={'notice mt-6 break-words ' + (notice.error ? 'notice-error' : '')}>{notice.text}</p>}

      {!role && (
        <form className="panel mt-8 max-w-xl space-y-4 p-5" onSubmit={e => { e.preventDefault(); void run(() => supabase.rpc('join_club', { p_slug: club.slug, p_code: club.join_policy === 'code' ? code.trim().toUpperCase() : null }), `Welcome to ${club.name}.`); }}>
          {club.join_policy === 'code' ? (
            <div>
              <label htmlFor="club-code" className="field-label">Join code</label>
              <input id="club-code" className="field max-w-48 font-mono uppercase tracking-[.2em]" maxLength={8} autoComplete="off" value={code} onChange={e => setCode(e.target.value)} aria-describedby="club-code-hint" />
              <p id="club-code-hint" className="mt-1 text-xs text-muted">This club joins by code. Ask a club admin for it.</p>
            </div>
          ) : <p className="text-sm">Anyone with the link can join. You will see the roster and the club&apos;s rides.</p>}
          <button type="submit" disabled={busy || (club.join_policy === 'code' && code.trim().length < 6)} className="btn btn-primary disabled:opacity-50">{busy ? 'Joining…' : `Join ${club.name}`}</button>
        </form>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-10">
          <section aria-labelledby="next-heading">
            <h2 id="next-heading" className="font-display text-xl font-semibold">Next rides</h2>
            {upcoming.length === 0 ? (
              <p className="notice mt-3">Nothing planned yet.{manage ? ' Plan one from a regular ride, or add a trip to the club from the app.' : ''}</p>
            ) : (
              <ul className="panel mt-3 divide-y divide-line">
                {upcoming.slice(0, 8).map(r => {
                  const inner = (
                    <>
                      <span className="w-24 shrink-0 rounded bg-raise px-2 py-1.5 text-center font-mono text-xs">{clubDate(r.start_date)}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span><span className="text-xs text-muted">{r.distance_km ? `${r.distance_km} km` : 'Route to be set'}{r.status === 'active' ? ' · Riding now' : ''}</span></span>
                      {role && <span aria-hidden="true" className="text-faint">→</span>}
                    </>
                  );
                  return <li key={r.id}>{role ? <Link href={`/app/trips/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-raise">{inner}</Link> : <div className="flex items-center gap-4 px-4 py-3">{inner}</div>}</li>;
                })}
              </ul>
            )}
          </section>

          {role && (
            <section aria-labelledby="series-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="series-heading" className="font-display text-xl font-semibold">Regular rides</h2>
                {manage && !seriesOpen && <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setSeriesOpen(true)}>New regular ride</button>}
              </div>
              {seriesOpen && <SeriesForm rides={view.rides} busy={busy} onCancel={() => setSeriesOpen(false)}
                onCreate={async (name, rule, template) => { if (await run(() => supabase.rpc('create_club_series', { p_club_id: club.id, p_name: name, p_rule: rule, p_template_ride_id: template }), `${name} added.`)) setSeriesOpen(false); }} />}
              {view.series.length === 0 && !seriesOpen ? (
                <p className="notice mt-3">{manage ? 'Set up a weekly or monthly ride once, then plan each date in one step.' : 'No regular rides yet.'}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {view.series.map(s => {
                    const next = nextUnplannedDate(s, today);
                    return (
                      <li key={s.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="font-medium">{s.name}</p>
                          <p className="text-xs text-muted">{describeRecurrence(s.recurrence_rule)}{s.planned_dates.length ? ` · ${s.planned_dates.length} planned` : ''}</p>
                        </div>
                        {manage && next && s.template_ride_id && (
                          <button type="button" disabled={busy} className="btn btn-ghost px-3 py-1.5 text-xs"
                            onClick={async () => {
                              if (busy) return;
                              setBusy(true); setNotice(null);
                              const { data, error } = await supabase.rpc('schedule_series_ride', { p_series_id: s.id, p_date: next });
                              setBusy(false);
                              if (error) { setNotice({ text: error.message || 'Could not plan that date.', error: true }); return; }
                              if (typeof data === 'string') router.push(`/app/trips/${data}`); else void refresh();
                            }}>Plan {clubDate(next)}</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        {role && (
          <section aria-labelledby="roster-heading">
            <h2 id="roster-heading" className="font-display text-xl font-semibold">Roster</h2>
            <ul className="panel mt-3 divide-y divide-line">
              {view.members.map(m => {
                const self = m.user_id === userId;
                const acts = manage && !self ? memberActions(m) : [];
                return (
                  <li key={m.user_id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line2 bg-raise font-mono text-xs">{m.display_name.slice(0, 2).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.display_name}{self ? ' (you)' : ''}</p>
                        <p className="text-xs text-muted">{memberHistoryText(m)}</p>
                      </div>
                      {m.role !== 'member' && <span className="chip chip-accent">{clubRoleLabel(m.role)}</span>}
                      {acts.length > 0 && <button type="button" className="text-xs text-muted underline hover:text-fg" aria-expanded={managing === m.user_id} aria-label={`Manage ${m.display_name}`} onClick={() => { setManaging(v => v === m.user_id ? null : m.user_id); setConfirmRemove(null); }}>Manage</button>}
                    </div>
                    {managing === m.user_id && (
                      <div role="group" aria-label={`Actions for ${m.display_name}`} className="mt-3 flex flex-wrap gap-2 pl-12">
                        {confirmRemove === m.user_id ? (
                          <>
                            <span className="self-center text-xs text-muted">Remove {m.display_name}? Their past club rides stay in their history.</span>
                            <button type="button" disabled={busy} className="btn btn-danger px-2.5 py-1 text-xs" onClick={async () => { if (await run(() => supabase.rpc('set_club_member_role', { p_club_id: club.id, p_user_id: m.user_id, p_role: 'removed' }), `${m.display_name} was removed from the club.`)) setManaging(null); }}>Remove</button>
                            <button type="button" className="text-xs underline" onClick={() => setConfirmRemove(null)}>Keep</button>
                          </>
                        ) : acts.map(a => (
                          <button key={a.label} type="button" disabled={busy} className={'btn px-2.5 py-1 text-xs ' + (a.danger ? 'hover:bg-raise text-danger' : 'btn-ghost')}
                            onClick={async () => {
                              if (a.role === 'removed') { setConfirmRemove(m.user_id); return; }
                              if (await run(() => supabase.rpc('set_club_member_role', { p_club_id: club.id, p_user_id: m.user_id, p_role: a.role }), `${m.display_name} is now ${article(a.role as ClubRole)}.`)) setManaging(null);
                            }}>{a.label}</button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {past.length > 0 && <p className="mt-3 text-sm text-muted">{past.length} ride{past.length === 1 ? '' : 's'} finished together · {past.reduce((n, r) => n + (r.distance_km || 0), 0).toLocaleString('en-IN')} km</p>}
            <div className="mt-6">
              {confirmLeave ? (
                <div role="group" aria-label={`Leave ${club.name}?`} className="notice flex flex-wrap items-center gap-3">
                  <span>Leave {club.name}? Your past club rides stay in your history.</span>
                  <button type="button" disabled={busy} className="btn btn-danger px-2.5 py-1 text-xs" onClick={async () => { if (await run(() => supabase.rpc('leave_club', { p_club_id: club.id }), `You left ${club.name}.`)) setConfirmLeave(false); }}>Leave</button>
                  <button type="button" className="text-xs underline" onClick={() => setConfirmLeave(false)}>Stay</button>
                </div>
              ) : <button type="button" className="text-sm text-muted underline hover:text-fg" onClick={() => setConfirmLeave(true)}>Leave club</button>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SeriesForm({ rides, busy, onCreate, onCancel }: { rides: ClubView['rides']; busy: boolean; onCreate: (name: string, rule: string, template: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [day, setDay] = useState<Weekday>('SU');
  const [pattern, setPattern] = useState('weekly');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rule = buildRecurrenceRule(PATTERNS.find(p => p.id === pattern)!.rule(day));

  return (
    <form className="panel mt-3 space-y-4 p-5" onSubmit={e => {
      e.preventDefault();
      if (name.trim().length < 3) { setError('Give the ride a name of at least 3 characters.'); return; }
      if (!template) { setError('Pick one of the club’s trips to copy each time.'); return; }
      setError(null); onCreate(name.trim(), rule, template);
    }}>
      <p className="eyebrow-label">{describeRecurrence(rule)}</p>
      <div><label htmlFor="s-name" className="field-label">Name</label><input id="s-name" className="field" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Sunday dawn ride" /></div>
      <fieldset>
        <legend className="field-label">Day</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map(d => (
            <label key={d.code} className={'cursor-pointer rounded border px-2.5 py-1.5 text-sm ' + (day === d.code ? 'border-accent text-fg' : 'border-line2 text-muted')}>
              <input type="radio" name="series-day" className="sr-only" checked={day === d.code} onChange={() => setDay(d.code)} />{d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="s-pattern" className="field-label">How often</label>
        <select id="s-pattern" className="field" value={pattern} onChange={e => setPattern(e.target.value)}>{PATTERNS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </div>
      <div>
        <label htmlFor="s-template" className="field-label">Copy this trip each time</label>
        <select id="s-template" className="field" value={template} onChange={e => setTemplate(e.target.value)} disabled={rides.length === 0}>
          <option value="">{rides.length ? 'Pick a club trip' : 'No club trips yet'}</option>
          {rides.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {rides.length === 0 && <p className="mt-1 text-xs text-muted">Add a trip to the club from the app first. That trip is copied for each date.</p>}
      </div>
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save regular ride'}</button>
        <button type="button" onClick={onCancel} className="btn hover:bg-raise">Cancel</button>
      </div>
    </form>
  );
}
