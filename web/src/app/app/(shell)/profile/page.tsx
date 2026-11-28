'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  changedProfileValues, formatLoginPhone, fuelRangeKm, normaliseLoginPhone, verifyPhoneCode, MOTORCYCLE_CATEGORIES, profileUpdateFor,
  type Profile, type ProfileFormInput, type ProfileSection, type RiderAnalytics,
} from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { useRequiredSession } from '@/lib/planner';
import { useFlags } from '@/lib/flags';
import SavedPlaces from '@/components/saved-places';
import PhoneCodeForm, { PHONE_LOGIN_ENABLED } from '@/components/phone-code-form';

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

function formFrom(p: Profile): ProfileFormInput {
  return {
    display_name: p.display_name || '', phone: p.phone || '', avatar_url: p.avatar_url || '',
    emergency_contact: p.emergency_contact || '', blood_group: p.blood_group || '',
    share_ice_with_ride: Boolean(p.share_ice_with_ride), share_phone_with_ride: Boolean(p.share_phone_with_ride),
    motorcycle_make: p.motorcycle_make || '', motorcycle_model: p.motorcycle_model || '', motorcycle_category: p.motorcycle_category || '',
    fuel_tank_capacity_liters: p.fuel_tank_capacity_liters != null ? String(p.fuel_tank_capacity_liters) : '',
    mileage_km_per_liter: p.mileage_km_per_liter != null ? String(p.mileage_km_per_liter) : '',
    fuel_reserve_liters: p.fuel_reserve_liters != null ? String(p.fuel_reserve_liters) : '',
  };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'R';
}

const SECTION_TITLES: Record<ProfileSection, string> = { rider: 'Rider', emergency: 'Emergency', bike: 'Motorcycle' };

export default function ProfilePage() {
  const session = useRequiredSession();
  const router = useRouter();
  const userId = session?.user.id;
  const flags = useFlags(userId);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [stats, setStats] = useState<RiderAnalytics | null | 'error'>(null);
  const [editing, setEditing] = useState<ProfileSection | null>(null);
  const [form, setForm] = useState<ProfileFormInput>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; section?: ProfileSection } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const [p, a] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.rpc('get_rider_analytics'),
      ]);
      if (cancelled) return;
      if (p.error || !p.data) setLoadError(true);
      else { setProfile(p.data as Profile); setLoadError(false); }
      setStats(a.error ? 'error' : (a.data as RiderAnalytics | null));
    })();
    return () => { cancelled = true; };
  }, [userId, reload]);

  const set = useCallback(<K extends keyof ProfileFormInput>(key: K, value: ProfileFormInput[K]) => setForm(f => ({ ...f, [key]: value })), []);

  function edit(section: ProfileSection) {
    if (!profile) return;
    setForm(formFrom(profile)); setNotice(null); setEditing(section);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !profile || busy) return;
    const result = profileUpdateFor(editing, form, { phoneSharing: flags.rider_phone_numbers });
    if (!result.ok) { setNotice({ text: result.error, error: true, section: editing }); return; }
    const changed = changedProfileValues(result.values, profile as unknown as Record<string, unknown>);
    if (Object.keys(changed).length === 0) { setEditing(null); return; }
    setBusy(true); setNotice(null);
    const { data, error } = await supabase.from('profiles').update(changed).eq('id', profile.id).select('*').single();
    setBusy(false);
    if (error || !data) { setNotice({ text: 'Could not save. Check your connection and try again. Nothing was changed.', error: true, section: editing }); return; }
    setProfile(data as Profile);
    setNotice({ text: `${SECTION_TITLES[editing]} details saved. The app shows them too.`, section: editing });
    setEditing(null);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (!error) router.replace('/login');
  }

  const sectionNotice = (s: ProfileSection) => notice && notice.section === s
    ? <p role={notice.error ? 'alert' : 'status'} className={'notice mt-4 ' + (notice.error ? 'notice-error' : '')}>{notice.text}</p> : null;
  const actions = (
    <div className="flex gap-3 pt-1">
      <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={() => { setEditing(null); setNotice(null); }} className="btn hover:bg-raise">Cancel</button>
    </div>
  );
  // One section at a time, so opening another never drops unsaved changes.
  const editButton = (s: ProfileSection, label: string) => editing !== s && (
    <button type="button" onClick={() => edit(s)} disabled={editing !== null} className="btn btn-ghost px-3 py-1.5 text-xs disabled:opacity-40" aria-label={label}>Edit</button>
  );
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{value || <span className="text-faint">Not set</span>}</dd>
    </div>
  );

  if (loadError) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8 lg:py-12">
        <h1 className="display text-4xl">Your profile</h1>
        <div role="alert" className="notice notice-error mt-6">Could not load your profile. Nothing has been changed. <button className="underline" onClick={() => { setLoadError(false); setReload(v => v + 1); }}>Try again</button></div>
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8 lg:py-12">
        <div role="status" aria-label="Loading your profile" className="space-y-3">
          <div className="h-12 w-64 animate-pulse rounded bg-surface" />
          <div className="h-28 animate-pulse rounded bg-surface" />
          <div className="h-40 animate-pulse rounded bg-surface" />
        </div>
      </main>
    );
  }

  const range = fuelRangeKm(profile);
  const bike = [profile.motorcycle_make, profile.motorcycle_model].filter(Boolean).join(' ');
  const category = MOTORCYCLE_CATEGORIES.find(c => c.value === profile.motorcycle_category)?.label;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8 lg:py-12">
      <p className="eyebrow-label">Rider profile</p>
      <div className="mt-3 flex items-center gap-4">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line2 bg-raise font-mono text-lg">{initials(profile.display_name || '')}</span>
        <div className="min-w-0">
          <h1 className="display truncate text-4xl sm:text-5xl">{profile.display_name || 'Rider'}</h1>
          <p className="mt-1 truncate text-sm text-muted">{session?.user.email || formatLoginPhone(session?.user.phone)}</p>
        </div>
      </div>

      <section aria-labelledby="stats-heading" className="mt-10">
        <h2 id="stats-heading" className="sr-only">Your riding</h2>
        {stats === 'error' ? (
          <p className="notice">Your riding totals could not load. <button className="underline" onClick={() => setReload(v => v + 1)}>Try again</button></p>
        ) : stats === null ? (
          <div role="status" aria-label="Loading your riding totals" className="h-24 animate-pulse rounded bg-surface" />
        ) : (
          <>
            <dl className="panel grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
              {[
                ['Distance', `${nf.format(stats.total_distance_km)} km`],
                ['Saddle time', `${nf.format(stats.total_hours)} h`],
                ['Trips finished', String(stats.completed_trips)],
                ['Trips under way', String(stats.active_trips)],
              ].map(([label, value]) => (
                <div key={label} className="p-4 sm:p-5">
                  <dt className="eyebrow-label">{label}</dt>
                  <dd className="mt-2 font-mono text-2xl">{value}</dd>
                </div>
              ))}
            </dl>
            {stats.milestones.length > 0 && (
              <ul aria-label="Milestones" className="mt-4 flex flex-wrap gap-2">
                {stats.milestones.map(m => <li key={m.id} className="chip chip-accent" title={m.description}>{m.title}</li>)}
              </ul>
            )}
            {stats.completed_trips === 0 && <p className="mt-3 text-sm text-muted">Totals grow as you finish rides with the group.</p>}
          </>
        )}
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="rider-heading" className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="rider-heading" className="font-display text-xl font-semibold">Rider</h2>
            {editButton('rider', 'Edit rider details')}
          </div>
          {sectionNotice('rider')}
          {editing === 'rider' ? (
            <form onSubmit={save} className="mt-4 space-y-4">
              <div><label htmlFor="p-name" className="field-label">Name riders see</label><input id="p-name" className="field" maxLength={60} autoComplete="nickname" value={form.display_name} onChange={e => set('display_name', e.target.value)} /></div>
              <div><label htmlFor="p-phone" className="field-label">Phone</label><input id="p-phone" className="field" type="tel" autoComplete="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 …" /></div>
              <div>
                <label htmlFor="p-photo" className="field-label">Photo link</label>
                <input id="p-photo" className="field" type="url" value={form.avatar_url} onChange={e => set('avatar_url', e.target.value)} placeholder="https://…" aria-describedby="p-photo-hint" />
                <p id="p-photo-hint" className="mt-1 text-xs text-faint">Shown in the app. The website shows your initials.</p>
              </div>
              {actions}
            </form>
          ) : (
            <dl className="mt-3">
              {row('Name', profile.display_name)}
              {row('Phone', profile.phone)}
              {row('Photo', profile.avatar_url ? 'Added' : null)}
            </dl>
          )}
        </section>

        <section aria-labelledby="ice-heading" className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="ice-heading" className="font-display text-xl font-semibold">Emergency</h2>
            {editButton('emergency', 'Edit emergency details')}
          </div>
          {sectionNotice('emergency')}
          {editing === 'emergency' ? (
            <form onSubmit={save} className="mt-4 space-y-4">
              <div><label htmlFor="p-ice" className="field-label">Emergency contact number</label><input id="p-ice" className="field" type="tel" value={form.emergency_contact} onChange={e => set('emergency_contact', e.target.value)} placeholder="+91 …" /></div>
              <div><label htmlFor="p-blood" className="field-label">Blood group</label><input id="p-blood" className="field max-w-32 uppercase" maxLength={3} value={form.blood_group} onChange={e => set('blood_group', e.target.value)} placeholder="B+" /></div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={Boolean(form.share_ice_with_ride)} onChange={e => set('share_ice_with_ride', e.target.checked)} />
                <span>Let riders on my ride see these details<span className="mt-0.5 block text-xs text-muted">Only active members of a ride you are on. Turning it off removes consent straight away.</span></span>
              </label>
              {flags.rider_phone_numbers && (
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={Boolean(form.share_phone_with_ride)} onChange={e => set('share_phone_with_ride', e.target.checked)} />
                  <span>Share my phone number for SOS texts<span className="mt-0.5 block text-xs text-muted">Goes only to people on the same live ride, and only when someone presses SOS.</span></span>
                </label>
              )}
              {actions}
            </form>
          ) : (
            <dl className="mt-3">
              {row('Contact', profile.emergency_contact)}
              {row('Blood group', profile.blood_group)}
              {row('Visible to my ride', profile.share_ice_with_ride ? 'Yes' : 'No')}
              {flags.rider_phone_numbers && row('Phone for SOS texts', profile.share_phone_with_ride ? 'Shared' : 'Not shared')}
            </dl>
          )}
        </section>

        <section aria-labelledby="bike-heading" className="panel p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 id="bike-heading" className="font-display text-xl font-semibold">Motorcycle</h2>
            {editButton('bike', 'Edit motorcycle')}
          </div>
          {sectionNotice('bike')}
          {editing === 'bike' ? (
            <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="p-make" className="field-label">Make</label><input id="p-make" className="field" maxLength={60} value={form.motorcycle_make} onChange={e => set('motorcycle_make', e.target.value)} placeholder="Royal Enfield" /></div>
              <div><label htmlFor="p-model" className="field-label">Model</label><input id="p-model" className="field" maxLength={60} value={form.motorcycle_model} onChange={e => set('motorcycle_model', e.target.value)} placeholder="Himalayan 450" /></div>
              <div>
                <label htmlFor="p-type" className="field-label">Type</label>
                <select id="p-type" className="field" value={form.motorcycle_category} onChange={e => set('motorcycle_category', e.target.value as ProfileFormInput['motorcycle_category'])}>
                  <option value="">Not set</option>
                  {MOTORCYCLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div><label htmlFor="p-tank" className="field-label">Tank (litres)</label><input id="p-tank" className="field" inputMode="decimal" value={form.fuel_tank_capacity_liters} onChange={e => set('fuel_tank_capacity_liters', e.target.value)} /></div>
              <div><label htmlFor="p-kmpl" className="field-label">Mileage (km per litre)</label><input id="p-kmpl" className="field" inputMode="decimal" value={form.mileage_km_per_liter} onChange={e => set('mileage_km_per_liter', e.target.value)} /></div>
              <div><label htmlFor="p-reserve" className="field-label">Reserve (litres)</label><input id="p-reserve" className="field" inputMode="decimal" value={form.fuel_reserve_liters} onChange={e => set('fuel_reserve_liters', e.target.value)} /></div>
              <div className="sm:col-span-2">{actions}</div>
            </form>
          ) : (
            <div className="mt-3 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
              <dl>
                {row('Bike', bike)}
                {row('Type', category)}
                {row('Tank', profile.fuel_tank_capacity_liters != null ? `${profile.fuel_tank_capacity_liters} L` : null)}
                {row('Mileage', profile.mileage_km_per_liter != null ? `${profile.mileage_km_per_liter} km/L` : null)}
                {row('Reserve', profile.fuel_reserve_liters != null ? `${profile.fuel_reserve_liters} L` : null)}
              </dl>
              <div className="rounded border border-line p-4 sm:w-56">
                <p className="eyebrow-label">Range on a full tank</p>
                {range ? (
                  <>
                    <p className="mt-2 font-mono text-3xl text-accent">{range.total} km</p>
                    {range.beforeReserve != null && <p className="mt-1 text-xs text-muted">{range.beforeReserve} km before reserve</p>}
                    <p className="mt-2 text-xs text-faint">An estimate for planning fuel stops.</p>
                  </>
                ) : <p className="mt-2 text-sm text-muted">Add tank size and mileage to see it.</p>}
              </div>
            </div>
          )}
        </section>
      </div>

      <SavedPlaces />

      <section aria-labelledby="account-heading" className="mt-12 border-t border-line pt-8">
        <h2 id="account-heading" className="font-display text-xl font-semibold">Account</h2>
        <p className="mt-1 text-sm text-muted">Phone-only settings, like crash detection and the lock screen card, are in the app.</p>
        {PHONE_LOGIN_ENABLED && <PhoneSignIn phone={session?.user.phone ?? null} hasEmail={Boolean(session?.user.email)} />}
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void signOut()} className="btn btn-ghost">Sign out</button>
          <button type="button" onClick={() => setDeleting(true)} className="btn hover:bg-raise text-danger">Delete account</button>
        </div>
      </section>

      {deleting && userId && <DeleteAccount userId={userId} onClose={() => setDeleting(false)} onDeleted={() => router.replace('/')} />}
    </main>
  );
}

function DeleteAccount({ userId, onClose, onDeleted }: { userId: string; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function confirm() {
    if (typed !== 'DELETE' || busy) return;
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc('delete_user_account', { p_expected_user_id: userId });
    if (rpcError) {
      setBusy(false);
      const club = /club/i.test(rpcError.message || '') || rpcError.code === '23503';
      setError(club
        ? 'Your account was not deleted. Accounts that started a club cannot be deleted from here yet.'
        : 'Your account was not deleted. ' + (rpcError.message || 'Try again.'));
      return;
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-desc" className="panel w-full max-w-md p-6">
        <h2 id="del-title" className="font-display text-xl font-semibold">Delete your account?</h2>
        <p id="del-desc" className="mt-2 text-sm text-muted">This permanently deletes your rider profile, motorcycle details, the rides you created and your personal logs, on the web and in the app. It cannot be undone.</p>
        <label htmlFor="del-confirm" className="field-label mt-5">Type DELETE to confirm</label>
        <input id="del-confirm" autoFocus className="field" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
        {error && <p role="alert" className="notice notice-error mt-4">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" disabled={typed !== 'DELETE' || busy} onClick={() => void confirm()} className="btn btn-danger disabled:opacity-50">{busy ? 'Deleting…' : 'Delete account'}</button>
          <button type="button" disabled={busy} onClick={onClose} className="btn hover:bg-raise">Keep my account</button>
        </div>
      </div>
    </div>
  );
}

/** An account adds a mobile number, confirmed by a texted code, and can then sign in with it. */
function PhoneSignIn({ phone, hasEmail }: { phone: string | null; hasEmail: boolean }) {
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState(phone);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  return (
    <div className="mt-6 panel p-5">
      <h3 className="font-display text-lg font-semibold">Sign in with your phone</h3>
      <p className="mt-1 text-sm text-muted">
        {linked
          ? `You can sign in with a code texted to ${formatLoginPhone(linked)}${hasEmail ? ', or with your email' : ''}.`
          : 'Add your mobile number to sign in with a texted code instead of your password.'}
      </p>
      {message && <p role={message.error ? 'alert' : 'status'} className={'mt-3 notice ' + (message.error ? 'notice-error' : '')}>{message.text}</p>}
      {open ? (
        <div className="mt-4 max-w-sm">
          <PhoneCodeForm
            mode="sign_in"
            idPrefix="link-phone"
            sendLabel="Text me a code"
            verifyLabel="Confirm number"
            onSend={async raw => {
              setMessage(null);
              const e164 = normaliseLoginPhone(raw);
              if (!e164) throw Object.assign(new Error('Enter a 10-digit Indian mobile number, or +country code and number.'), { code: 'phone_invalid' });
              const { error } = await supabase.auth.updateUser({ phone: e164 });
              if (error) throw Object.assign(new Error(error.message), { code: error.code, status: error.status });
              return e164;
            }}
            onVerify={async (e164, code) => {
              await verifyPhoneCode(supabase, e164, code, 'phone_change');
              await supabase.auth.refreshSession().catch(() => {});
              setLinked(e164);
              setOpen(false);
              setMessage({ text: 'Number confirmed. You can now sign in with it.' });
            }}
            onProblem={p => setMessage({ text: p.message, error: true })}
          />
          <button type="button" onClick={() => setOpen(false)} className="mt-3 text-sm text-muted hover:text-fg">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setMessage(null); setOpen(true); }} className="btn btn-ghost mt-4">{linked ? 'Change number' : 'Add mobile number'}</button>
      )}
    </div>
  );
}
