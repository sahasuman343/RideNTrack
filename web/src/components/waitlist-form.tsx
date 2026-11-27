'use client';
import { useEffect, useId, useState } from 'react';
import { SUPPORT_EMAIL, WAITLIST_OFFER } from '@/lib/site';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Calls a public database function with plain fetch, so marketing pages don't load the Supabase client. */
async function rpc<T>(name: string, body: object): Promise<{ ok: true; data: T } | { ok: false; status: number; message?: string }> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null) as { message?: string } | null;
    return { ok: false, status: res.status, message: err?.message };
  }
  return { ok: true, data: await res.json() as T };
}

type Done = { email: string; early: boolean };

export default function WaitlistForm({ headingId }: { headingId?: string }) {
  const id = useId();
  const [placesLeft, setPlacesLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let live = true;
    rpc<number>('waitlist_places_left', {})
      .then(r => { if (live && r.ok && typeof r.data === 'number') setPlacesLeft(r.data); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') || '').trim();
    const name = String(form.get('name') || '').trim();
    setError('');
    if (!EMAIL.test(email)) { setError('Enter a valid email address.'); return; }
    // Bots fill the hidden field; they get the normal answer and nothing is saved.
    if (form.get('website')) { setDone({ email, early: false }); return; }
    setBusy(true);
    try {
      const r = await rpc<{ early?: boolean }>('join_waitlist', { p_email: email, p_name: name || null });
      if (r.ok) setDone({ email, early: !!r.data?.early });
      else if (r.status === 429) setError('Too many tries. Wait a minute and try again.');
      else if (r.status === 400 && r.message) setError(r.message.endsWith('.') ? r.message : r.message + '.');
      else setError('Couldn’t join the waitlist just now. Try again in a moment.');
    } catch {
      setError('No connection. Check your network and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="notice">
        {done.early
          ? <p><strong className="text-accent">You’re one of the first {WAITLIST_OFFER.places}.</strong> Pro is yours free for {WAITLIST_OFFER.months} months when the app launches. We’ll write to {done.email}.</p>
          : <p><strong className="text-fg">You’re on the list.</strong> We’ll write to {done.email} when the app launches.</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={headingId} className="grid gap-3">
      {placesLeft !== null && (
        <p className="font-mono text-xs uppercase tracking-[.12em] text-accent" aria-live="polite">
          {placesLeft > 0 ? `${placesLeft} of ${WAITLIST_OFFER.places} free Pro places left` : `All ${WAITLIST_OFFER.places} free Pro places are taken`}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor={id + 'email'} className="field-label">Email</label>
          <input id={id + 'email'} name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} className="field" aria-invalid={!!error || undefined} aria-describedby={error ? id + 'err' : undefined} />
        </div>
        <div>
          <label htmlFor={id + 'name'} className="field-label">Name <span className="normal-case tracking-normal text-faint">(optional)</span></label>
          <input id={id + 'name'} name="name" type="text" autoComplete="name" maxLength={80} className="field" />
        </div>
      </div>
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Website <input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {error && <p id={id + 'err'} role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Joining…' : 'Join the waitlist'}</button>
        <p className="text-xs text-faint">We use your email only for the waitlist and launch news.{SUPPORT_EMAIL ? ` To be removed, write to ${SUPPORT_EMAIL}.` : ''}</p>
      </div>
    </form>
  );
}
