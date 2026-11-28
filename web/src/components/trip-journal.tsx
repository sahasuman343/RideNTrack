'use client';
import { useEffect, useState } from 'react';
import type { JournalPhoto, TripJournalEntry } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

interface Props { tripId: string; userId: string; tripName: string }

const MAX_PHOTOS = 20;

/** Only plain https links are kept, so a pasted javascript: or data: URL never becomes a link. */
export function safePhotoUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Your own notes about the trip, the same entry the app's journal shows. */
export default function TripJournal({ tripId, userId, tripName }: Props) {
  const [entry, setEntry] = useState<TripJournalEntry | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [form, setForm] = useState({ title: '', notes: '', highlights: '', rating: 5, photos: [] as JournalPhoto[], photoUrl: '', photoCaption: '' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await supabase.from('trip_journal_entries').select('*').eq('ride_id', tripId).eq('user_id', userId).maybeSingle();
      if (cancelled) return;
      if (error) { setLoadError(true); return; }
      setEntry((data as TripJournalEntry | null) ?? null); setLoadError(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [tripId, userId, reload]);

  function startEdit() {
    setForm({
      title: entry?.title || tripName, notes: entry?.notes || '', highlights: entry?.highlights || '',
      rating: entry?.rating ?? 5, photos: Array.isArray(entry?.photos) ? entry.photos : [], photoUrl: '', photoCaption: '',
    });
    setNotice(null); setEditing(true);
  }

  function addPhoto() {
    const url = safePhotoUrl(form.photoUrl);
    if (!url) { setNotice({ text: 'Paste a photo link that starts with https://.', error: true }); return; }
    if (form.photos.length >= MAX_PHOTOS) { setNotice({ text: `Up to ${MAX_PHOTOS} photo links per entry.`, error: true }); return; }
    setNotice(null);
    setForm(f => ({ ...f, photos: [...f.photos, { url, caption: f.photoCaption.trim() || undefined, taken_at: new Date().toISOString() }], photoUrl: '', photoCaption: '' }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!form.title.trim()) { setNotice({ text: 'Give the entry a title.', error: true }); return; }
    setBusy(true); setNotice(null);
    const { error } = await supabase.rpc('save_trip_journal_entry', {
      p_ride_id: tripId, p_title: form.title.trim(), p_notes: form.notes.trim() || null,
      p_highlights: form.highlights.trim() || null, p_rating: form.rating, p_photos: form.photos,
    });
    setBusy(false);
    if (error) {
      setNotice({ text: /participant|42501/i.test(error.message || '') ? 'Only riders on this trip can keep a journal for it.' : error.message || 'Could not save the journal. Check your connection.', error: true });
      return;
    }
    setEditing(false); setNotice({ text: 'Journal saved.' }); setReload(v => v + 1);
  }

  return (
    <section aria-labelledby="journal-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="journal-heading" className="font-display text-xl font-semibold">Journal</h2>
        {!editing && entry !== undefined && !loadError && <button type="button" onClick={startEdit} className="btn btn-ghost px-3 py-1.5 text-xs">{entry ? 'Edit entry' : 'Write entry'}</button>}
      </div>
      <p className="mt-1 text-xs text-muted">Your own notes about this trip. Riders on the trip can read them, and they show in the app too.</p>

      {notice && <p role={notice.error ? 'alert' : 'status'} className={'notice mt-4 ' + (notice.error ? 'notice-error' : '')}>{notice.text}</p>}

      {loadError ? (
        <div role="alert" className="notice notice-error mt-4">Could not load your journal. <button className="underline" onClick={() => { setLoadError(false); setReload(v => v + 1); }}>Try again</button></div>
      ) : entry === undefined ? (
        <div role="status" aria-label="Loading journal" className="mt-4 h-32 animate-pulse rounded bg-surface" />
      ) : editing ? (
        <form onSubmit={save} className="panel mt-4 space-y-4 p-5">
          <div><label htmlFor="journal-title" className="field-label">Title</label><input id="journal-title" className="field" maxLength={120} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div><label htmlFor="journal-notes" className="field-label">How it went</label><textarea id="journal-notes" className="field min-h-32" maxLength={10000} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Roads, weather, the chai stop nobody will forget." /></div>
          <div><label htmlFor="journal-highlights" className="field-label">Highlights</label><input id="journal-highlights" className="field" maxLength={500} value={form.highlights} onChange={e => setForm(f => ({ ...f, highlights: e.target.value }))} /></div>
          <fieldset>
            <legend className="field-label">Rating</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <label key={n} className={'flex h-9 w-9 cursor-pointer items-center justify-center rounded border font-mono text-sm ' + (form.rating >= n ? 'border-accent text-accent' : 'border-line2 text-faint')}>
                  <input type="radio" name="journal-rating" className="sr-only" checked={form.rating === n} onChange={() => setForm(f => ({ ...f, rating: n }))} aria-label={`${n} out of 5`} />
                  <span aria-hidden="true">★</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="field-label">Photo links</legend>
            <p className="-mt-1 mb-2 text-xs text-faint">Paste links to photos you have shared elsewhere. Uploading photos is in the app.</p>
            {form.photos.length > 0 && (
              <ul className="mb-3 space-y-2">
                {form.photos.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded border border-line px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{p.caption || p.url}</span>
                    <button type="button" className="shrink-0 text-xs text-muted underline hover:text-danger" onClick={() => setForm(f => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))} aria-label={'Remove photo ' + (p.caption || i + 1)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto]">
              <input aria-label="Photo link" className="field" placeholder="https://…" value={form.photoUrl} onChange={e => setForm(f => ({ ...f, photoUrl: e.target.value }))} />
              <input aria-label="Photo caption" className="field" placeholder="Caption" maxLength={140} value={form.photoCaption} onChange={e => setForm(f => ({ ...f, photoCaption: e.target.value }))} />
              <button type="button" onClick={addPhoto} className="btn btn-ghost">Add photo</button>
            </div>
          </fieldset>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save journal'}</button>
            <button type="button" onClick={() => setEditing(false)} className="btn hover:bg-raise">Cancel</button>
          </div>
        </form>
      ) : !entry ? (
        <p className="notice mt-4">Nothing written yet. Jot down the roads, the stops and the people while it is fresh.</p>
      ) : (
        <article className="panel mt-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="display text-2xl">{entry.title}</h3>
            {entry.rating != null && <span className="text-lg tracking-wider text-accent" role="img" aria-label={`Rated ${entry.rating} out of 5`}>{'★'.repeat(entry.rating)}<span className="text-faint">{'★'.repeat(5 - entry.rating)}</span></span>}
          </div>
          {entry.highlights && <p className="mt-2 text-sm text-muted">{entry.highlights}</p>}
          {entry.notes && <p className="mt-4 whitespace-pre-line text-sm leading-6">{entry.notes}</p>}
          {Array.isArray(entry.photos) && entry.photos.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm" aria-label="Photos">
              {entry.photos.map((p, i) => {
                const url = safePhotoUrl(p.url);
                return <li key={i}>{url ? <a className="underline hover:text-accent" href={url} target="_blank" rel="noopener noreferrer nofollow">{p.caption || 'Photo ' + (i + 1)}</a> : <span className="text-muted">{p.caption || 'Photo ' + (i + 1)} (in the app)</span>}</li>;
              })}
            </ul>
          )}
          {entry.updated_at && <p className="mt-4 text-xs text-faint">Updated {new Date(entry.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
        </article>
      )}
    </section>
  );
}
