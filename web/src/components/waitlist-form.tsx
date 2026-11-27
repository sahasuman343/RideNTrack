'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { SUPPORT_EMAIL, WAITLIST_OFFER } from '@/lib/site';

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Turnstile = {
  render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void; 'error-callback'?: () => void; theme?: string }): string;
  reset(id?: string): void;
};
declare global { interface Window { turnstile?: Turnstile } }

/** Loads Cloudflare Turnstile once per page. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = TURNSTILE_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile'))));
    script.addEventListener('error', () => reject(new Error('turnstile blocked')));
  });
}

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

type Done = { email: string };

export default function WaitlistForm({ headingId }: { headingId?: string }) {
  const id = useId();
  const [placesLeft, setPlacesLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [captcha, setCaptcha] = useState('');
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const widgetEl = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !widgetEl.current) return;
    let live = true;
    loadTurnstile().then(t => {
      if (!live || !widgetEl.current || widgetId.current) return;
      widgetId.current = t.render(widgetEl.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: token => { setCaptcha(token); setCaptchaFailed(false); },
        'expired-callback': () => setCaptcha(''),
        'error-callback': () => { setCaptcha(''); setCaptchaFailed(true); },
      });
    }).catch(() => { if (live) setCaptchaFailed(true); });
    return () => { live = false; };
  }, []);

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
    if (form.get('website')) { setDone({ email }); return; }
    if (!TURNSTILE_SITE_KEY) { setError('The waitlist isn’t open yet. Try again soon.'); return; }
    if (!captcha) { setError(captchaFailed ? 'The bot check couldn’t load. Turn off blockers for this page and reload.' : 'Wait for the check below to finish, then try again.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${URL_BASE}/functions/v1/waitlist-join`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || null, turnstile_token: captcha }),
      });
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (res.ok) setDone({ email });
      else if (res.status === 429) setError('Too many tries. Wait a while and try again.');
      else if ((res.status === 400 || res.status === 403 || res.status === 503) && body?.error) setError(body.error);
      else setError('Couldn’t join the waitlist just now. Try again in a moment.');
      if (!res.ok && widgetId.current) { window.turnstile?.reset(widgetId.current); setCaptcha(''); }
    } catch {
      setError('No connection. Check your network and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="notice">
        <p><strong className="text-fg">Check your email.</strong> We sent a link to {done.email}. Open it to confirm your place. The first {WAITLIST_OFFER.places} people to confirm get Pro free for {WAITLIST_OFFER.months} months.</p>
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
      <div ref={widgetEl} className="min-h-[65px]" />
      {error && <p id={id + 'err'} role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Joining…' : 'Join the waitlist'}</button>
        <p className="text-xs text-faint">We use your email only for the waitlist and launch news.{SUPPORT_EMAIL ? ` To be removed, write to ${SUPPORT_EMAIL}.` : ''}</p>
      </div>
    </form>
  );
}
