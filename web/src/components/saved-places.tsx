'use client';
import { useEffect, useState } from 'react';
import { parseCoordinates, SAVED_PLACE_CATEGORIES, type SavedPlaceCategory, type UserSavedPlace } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

const CATEGORIES = Object.entries(SAVED_PLACE_CATEGORIES) as [SavedPlaceCategory, { label: string }][];
const EMPTY = { name: '', category: 'viewpoint' as SavedPlaceCategory, address: '', lat: '', lng: '', notes: '' };

/** Bookmarked places, the same list the app's profile shows. */
export default function SavedPlaces() {
  const [places, setPlaces] = useState<UserSavedPlace[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<UserSavedPlace | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('get_user_saved_places').then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setLoadError(true); return; }
      setPlaces((data as UserSavedPlace[]) || []); setLoadError(false);
    });
    return () => { cancelled = true; };
  }, [reload]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!form.name.trim()) { setNotice({ text: 'Give the place a name.', error: true }); return; }
    const coords = parseCoordinates(form.lat, form.lng);
    if (!coords) { setNotice({ text: 'Enter a latitude from -90 to 90 and a longitude from -180 to 180.', error: true }); return; }
    setBusy(true); setNotice(null);
    const { error } = await supabase.rpc('add_saved_place', {
      p_name: form.name.trim(), p_category: form.category, p_latitude: coords.lat, p_longitude: coords.lng,
      p_address: form.address.trim() || null, p_notes: form.notes.trim() || null,
    });
    setBusy(false);
    if (error) { setNotice({ text: error.message || 'Could not save the place. Try again.', error: true }); return; }
    setNotice({ text: `${form.name.trim()} saved.` }); setForm(EMPTY); setAdding(false); setReload(v => v + 1);
  }

  async function remove(place: UserSavedPlace) {
    setConfirm(null); setNotice(null);
    const { error } = await supabase.rpc('delete_saved_place', { p_place_id: place.id });
    if (error) { setNotice({ text: `Could not remove ${place.name}. Try again.`, error: true }); return; }
    setPlaces(ps => (ps || []).filter(p => p.id !== place.id));
    setNotice({ text: `${place.name} removed.` });
  }

  return (
    <section aria-labelledby="places-heading" className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="places-heading" className="font-display text-xl font-semibold">Saved places{places && places.length > 0 ? ` (${places.length})` : ''}</h2>
        {!adding && !loadError && places && <button type="button" onClick={() => { setAdding(true); setNotice(null); }} className="btn btn-ghost px-3 py-1.5 text-xs">Add place</button>}
      </div>
      <p className="mt-1 text-xs text-muted">Passes, dhabas, mechanics and viewpoints you want to find again. Only you see them.</p>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={'notice mt-4 ' + (notice.error ? 'notice-error' : '')}>{notice.text}</p>}

      {adding && (
        <form onSubmit={add} className="panel mt-4 grid gap-4 p-5 sm:grid-cols-2">
          <div><label htmlFor="sp-name" className="field-label">Name</label><input id="sp-name" className="field" maxLength={100} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Kunzum La top" /></div>
          <div>
            <label htmlFor="sp-cat" className="field-label">Kind of place</label>
            <select id="sp-cat" className="field" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as SavedPlaceCategory }))}>
              {CATEGORIES.map(([value, c]) => <option key={value} value={value}>{c.label}</option>)}
            </select>
          </div>
          <div><label htmlFor="sp-lat" className="field-label">Latitude</label><input id="sp-lat" className="field" inputMode="decimal" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} placeholder="32.39" /></div>
          <div><label htmlFor="sp-lng" className="field-label">Longitude</label><input id="sp-lng" className="field" inputMode="decimal" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} placeholder="77.64" /></div>
          <div className="sm:col-span-2"><label htmlFor="sp-addr" className="field-label">Address or landmark</label><input id="sp-addr" className="field" maxLength={200} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
          <div className="sm:col-span-2"><label htmlFor="sp-notes" className="field-label">Notes</label><textarea id="sp-notes" className="field min-h-20" maxLength={500} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 sm:col-span-2">
            <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save place'}</button>
            <button type="button" onClick={() => { setAdding(false); setNotice(null); }} className="btn hover:bg-raise">Cancel</button>
          </div>
        </form>
      )}

      {loadError ? (
        <div role="alert" className="notice notice-error mt-4">Could not load your saved places. <button className="underline" onClick={() => { setLoadError(false); setReload(v => v + 1); }}>Try again</button></div>
      ) : places === null ? (
        <div role="status" aria-label="Loading saved places" className="mt-4 h-20 animate-pulse rounded bg-surface" />
      ) : places.length === 0 ? (
        !adding && <p className="notice mt-4">No saved places yet.</p>
      ) : (
        <ul className="panel mt-4 divide-y divide-line">
          {places.map(p => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{p.name}</p>
                <p className="mt-0.5 text-xs text-muted">{SAVED_PLACE_CATEGORIES[p.category]?.label ?? 'Place'} · <span className="font-mono">{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}</span>{p.address ? ` · ${p.address}` : ''}</p>
                {p.notes && <p className="mt-1 text-sm text-muted">{p.notes}</p>}
              </div>
              {confirm?.id === p.id ? (
                <span role="group" aria-label={`Remove ${p.name}?`} className="flex items-center gap-2 text-xs">
                  <span className="text-muted">Remove?</span>
                  <button type="button" className="btn btn-danger px-2.5 py-1 text-xs" onClick={() => void remove(p)}>Remove</button>
                  <button type="button" className="underline" onClick={() => setConfirm(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" className="text-xs text-muted underline hover:text-danger" onClick={() => setConfirm(p)} aria-label={`Remove ${p.name}`}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
